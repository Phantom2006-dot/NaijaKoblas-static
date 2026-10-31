import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool, type PoolClient } from "pg";
import { decideBaselineAdoption, extractBaselineObjects, validateMigrationHistory } from "./baselineAdoption";
import {
  extractPendingMigrationObjects,
  findAlreadyPresentPendingMigrationObjects,
  type PublicMigrationObjectCatalog,
} from "./pendingObjects";
import { assertExistingBaselineMatches } from "./schemaFingerprint";

const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL for migrations.");

const migrationsFolder = fileURLToPath(new URL("../../drizzle/postgres", import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder });
const baseline = migrations[0];
if (!baseline) throw new Error("No PostgreSQL baseline migration was found.");
const baselineObjects = extractBaselineObjects(baseline.sql);

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 5_000,
});
const client = await pool.connect();

async function readPublicMigrationObjectCatalog(
  connection: PoolClient,
): Promise<PublicMigrationObjectCatalog> {
  const tables = await connection.query<{ relname: string }>(
    `SELECT relation.relname
     FROM pg_class AS relation
     JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public' AND relation.relkind IN ('r', 'p')`,
  );
  const enums = await connection.query<{ typname: string }>(
    `SELECT type.typname
     FROM pg_type AS type
     JOIN pg_namespace AS ns ON ns.oid = type.typnamespace
     WHERE ns.nspname = 'public' AND type.typtype = 'e'`,
  );
  const indexes = await connection.query<{ relname: string }>(
    `SELECT relation.relname
     FROM pg_class AS relation
     JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public' AND relation.relkind = 'i'`,
  );
  const sequences = await connection.query<{ relname: string }>(
    `SELECT relation.relname
     FROM pg_class AS relation
     JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public' AND relation.relkind = 'S'`,
  );
  const constraints = await connection.query<{ table_name: string; name: string }>(
    `SELECT relation.relname AS table_name, constraint_row.conname AS name
     FROM pg_constraint AS constraint_row
     JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
     JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public'`,
  );

  return {
    tableNames: tables.rows.map((row) => row.relname),
    enumNames: enums.rows.map((row) => row.typname),
    indexNames: indexes.rows.map((row) => row.relname),
    sequenceNames: sequences.rows.map((row) => row.relname),
    constraints: constraints.rows.map(({ table_name, name }) => ({ tableName: table_name, name })),
  };
}

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    "naijakoblas:drizzle:postgres-migrations",
  ]);
  await client.query('SET LOCAL search_path TO "public"');

  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const ledgerResult = await client.query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at::text AS created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at, id',
  );
  const ledgerRows = ledgerResult.rows.map((row) => ({ hash: row.hash, createdAt: row.created_at }));
  let appliedCount = validateMigrationHistory(ledgerRows, migrations);

  const enumResult = await client.query<{ typname: string }>(
    `SELECT type.typname
     FROM pg_type AS type
     JOIN pg_namespace AS ns ON ns.oid = type.typnamespace
     WHERE ns.nspname = 'public'
       AND type.typtype = 'e'
       AND type.typname = ANY($1::text[])`,
    [baselineObjects.enumNames],
  );
  const tableResult = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name = ANY($1::text[])`,
    [baselineObjects.tableNames],
  );

  const decision = decideBaselineAdoption(
    { hash: baseline.hash, folderMillis: baseline.folderMillis },
    baselineObjects,
    {
      existingEnumNames: enumResult.rows.map((row) => row.typname),
      existingTableNames: tableResult.rows.map((row) => row.table_name),
      ledgerRows,
    },
  );

  if (decision !== "fresh") {
    await assertExistingBaselineMatches(client, baseline.sql, baselineObjects);
  }

  if (decision === "adopt") {
    await client.query(
      'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
      [baseline.hash, baseline.folderMillis],
    );
    appliedCount = 1;
    console.log("[Migrations] Verified and recorded the pre-existing PostgreSQL baseline.");
  }

  const pendingMigrations = migrations.slice(appliedCount);
  if (pendingMigrations.length > 0) {
    const pendingObjects = extractPendingMigrationObjects(pendingMigrations);
    const existingPendingObjects = findAlreadyPresentPendingMigrationObjects(
      pendingObjects,
      await readPublicMigrationObjectCatalog(client),
    );
    if (existingPendingObjects.length > 0) {
      throw new Error(
        `Pending migration objects/data targets already exist without matching ledger rows (${existingPendingObjects.join(", " )}); refusing to replay.`,
      );
    }
  }

  for (const migration of pendingMigrations) {
    for (const statement of migration.sql) {
      await client.query(statement);
    }
    await client.query(
      'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
      [migration.hash, migration.folderMillis],
    );
  }

  await client.query("COMMIT");
  console.log(`[Migrations] Applied ${pendingMigrations.length} pending PostgreSQL migration(s).`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
