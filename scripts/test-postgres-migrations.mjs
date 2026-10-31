import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  extractPendingMigrationObjects,
  findAlreadyPresentPendingMigrationObjects,
} from "../dist/migrations/pendingObjects.js";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const root = process.cwd();
const runnerPath = path.join(root, "dist/migrations/run.js");
if (!existsSync(runnerPath)) {
  throw new Error("Build the app first with `pnpm build` so dist/migrations/run.js exists.");
}

const configuredUrl = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!configuredUrl) {
  throw new Error("Set MIGRATIONS_TEST_DATABASE_URL to a disposable local PostgreSQL admin URL ending in /postgres.");
}
const adminUrl = new URL(configuredUrl);
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
if (!localHosts.has(adminUrl.hostname.toLowerCase())) {
  throw new Error("Integration tests are restricted to localhost PostgreSQL; remote hosts are rejected.");
}
if (adminUrl.pathname !== "/postgres") {
  throw new Error("MIGRATIONS_TEST_DATABASE_URL must connect to the local maintenance database /postgres.");
}

const migrations = readMigrationFiles({ migrationsFolder: path.join(root, "drizzle/postgres") });
assert.ok(migrations.length >= 3, "Expected baseline, gallery/notification, and image-format migrations.");
const testTag = randomBytes(5).toString("hex");
const createdDatabases = [];
const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();

function databaseUrl(databaseName) {
  const url = new URL(adminUrl.toString());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function createTestDatabase(label) {
  const name = `nk_mig_${testTag}_${label}`;
  await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  createdDatabases.push(name);
  return name;
}

async function withClient(databaseName, callback) {
  const client = new Client({ connectionString: databaseUrl(databaseName) });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function runMigrationRunner(databaseName) {
  try {
    const result = await execFileAsync(process.execPath, [runnerPath], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(databaseName),
        DATABASE_URL_UNPOOLED: "",
        NODE_ENV: "test",
      },
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      message: String(error.message ?? "Migration runner failed."),
    };
  }
}

async function expectRunnerFailure(databaseName, expectedText) {
  const result = await runMigrationRunner(databaseName);
  assert.equal(result.ok, false, "Expected the migration runner to refuse this unsafe state.");
  const output = `${result.stdout}\n${result.stderr}\n${result.message}`;
  assert.ok(output.includes(expectedText), `Expected failure text ${JSON.stringify(expectedText)}.`);
}

async function applyBaseline(databaseName, seedAccount = false) {
  await withClient(databaseName, async (client) => {
    await client.query("BEGIN");
    try {
      for (const statement of migrations[0].sql) await client.query(statement);
      if (seedAccount) {
        await client.query(
          'INSERT INTO "users" ("openId", "email") VALUES ($1, $2)',
          [`migration-test-${testTag}`, "migration-test@example.invalid"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function applyMigrationWithoutLedger(databaseName, migrationIndex) {
  await withClient(databaseName, async (client) => {
    await client.query("BEGIN");
    try {
      for (const statement of migrations[migrationIndex].sql) await client.query(statement);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function writeLedgerPrefix(databaseName, migrationIndexes) {
  await withClient(databaseName, async (client) => {
    await client.query('CREATE SCHEMA "drizzle"');
    await client.query(`
      CREATE TABLE "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    for (const index of migrationIndexes) {
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
        [migrations[index].hash, migrations[index].folderMillis],
      );
    }
  });
}

async function assertLedgerMatchesJournal(databaseName) {
  await withClient(databaseName, async (client) => {
    const { rows } = await client.query(
      'SELECT hash, created_at::text AS created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at, id',
    );
    assert.equal(rows.length, migrations.length, "Expected exactly one ledger row for each migration.");
    rows.forEach((row, index) => {
      assert.equal(row.hash, migrations[index].hash);
      assert.equal(Number(row.created_at), migrations[index].folderMillis);
    });
  });
}

async function assertUserPreserved(databaseName) {
  await withClient(databaseName, async (client) => {
    const { rows } = await client.query(
      'SELECT "openId", "email" FROM "public"."users" WHERE "openId" = $1',
      [`migration-test-${testTag}`],
    );
    assert.deepEqual(rows, [
      { openId: `migration-test-${testTag}`, email: "migration-test@example.invalid" },
    ]);
  });
}

async function readPublicMigrationCatalog(client) {
  const tables = await client.query(
    `SELECT relation.relname
     FROM pg_class AS relation JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public' AND relation.relkind IN ('r', 'p')`,
  );
  const enums = await client.query(
    `SELECT type.typname
     FROM pg_type AS type JOIN pg_namespace AS ns ON ns.oid = type.typnamespace
     WHERE ns.nspname = 'public' AND type.typtype = 'e'`,
  );
  const indexes = await client.query(
    `SELECT relation.relname
     FROM pg_class AS relation JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public' AND relation.relkind = 'i'`,
  );
  const sequences = await client.query(
    `SELECT relation.relname
     FROM pg_class AS relation JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
     WHERE ns.nspname = 'public' AND relation.relkind = 'S'`,
  );
  const constraints = await client.query(
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

async function testFreshDatabaseAndSearchPath() {
  const name = await createTestDatabase("fresh");
  const shadowSchema = `nk_search_${testTag}`;
  await withClient(name, async (client) => {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(shadowSchema)}`);
  });
  await admin.query(
    `ALTER DATABASE ${quoteIdentifier(name)} SET search_path TO ${quoteIdentifier(shadowSchema)}, public`,
  );

  assert.equal((await runMigrationRunner(name)).ok, true);
  assert.equal((await runMigrationRunner(name)).ok, true);
  await assertLedgerMatchesJournal(name);
  await withClient(name, async (client) => {
    const { rows } = await client.query(
      `SELECT users_schema.nspname AS users_schema,
              to_regclass($1) AS shadow_users
       FROM pg_class AS users_relation
       JOIN pg_namespace AS users_schema ON users_schema.oid = users_relation.relnamespace
       WHERE users_relation.oid = to_regclass('"public"."users"')`,
      [`"${shadowSchema}"."users"`],
    );
    assert.equal(rows[0]?.users_schema, "public");
    assert.equal(rows[0]?.shadow_users, null, "Migrations must not follow an unsafe ambient search_path.");
  });
  console.log("PASS fresh database: two runs, exact ledger and explicit public search_path");
}

async function testPreAppliedBaselineAndDataPreservation() {
  const name = await createTestDatabase("adopt");
  await applyBaseline(name, true);
  assert.equal((await runMigrationRunner(name)).ok, true);
  assert.equal((await runMigrationRunner(name)).ok, true);
  await assertLedgerMatchesJournal(name);
  await assertUserPreserved(name);
  console.log("PASS exact pre-applied baseline: two runs, existing user preserved, exact ledger");
}

async function testSchemaMismatchRefusal() {
  const name = await createTestDatabase("mismatch");
  await applyBaseline(name, true);
  await withClient(name, async (client) => {
    await client.query('ALTER TYPE "public"."account_role" RENAME VALUE \'customer\' TO \'buyer\'');
  });
  await expectRunnerFailure(name, "baseline does not match");
  await assertUserPreserved(name);
  await withClient(name, async (client) => {
    const { rows } = await client.query(`SELECT to_regclass('"public"."sellerProductImages"') AS gallery`);
    assert.equal(rows[0]?.gallery, null, "A refused migration must not add gallery tables.");
  });
  console.log("PASS altered enum: refusal before gallery migrations; user row preserved");
}

async function testUnledgeredLaterMigrationRefusal() {
  const name = await createTestDatabase("unledgered");
  await applyBaseline(name, true);
  await applyMigrationWithoutLedger(name, 1);
  await expectRunnerFailure(name, "Pending migration objects/data targets already exist");
  await assertUserPreserved(name);
  await withClient(name, async (client) => {
    const { rows } = await client.query(
      `SELECT to_regclass('public."sellerProductImages"') AS gallery,
              to_regclass('drizzle."__drizzle_migrations"') AS ledger`,
    );
    assert.equal(rows[0]?.gallery, "\"sellerProductImages\"");
    assert.equal(rows[0]?.ledger, null, "Refusal should roll back the baseline adoption ledger row/table.");
  });
  console.log("PASS unledgered later schema: runner refused replay and rolled back ledger adoption");
}

async function testConstraintOnlyMigrationRefusal() {
  const name = await createTestDatabase("constraint");
  await applyBaseline(name, true);
  await applyMigrationWithoutLedger(name, 1);
  await writeLedgerPrefix(name, [0, 1]);
  await applyMigrationWithoutLedger(name, 2);
  await expectRunnerFailure(name, "Pending migration objects/data targets already exist");
  await assertUserPreserved(name);
  await withClient(name, async (client) => {
    const ledger = await client.query('SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations"');
    const constraint = await client.query(
      `SELECT constraint_row.conname
       FROM pg_constraint AS constraint_row
       JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
       JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
       WHERE ns.nspname = 'public'
         AND relation.relname = 'sellerProductImages'
         AND constraint_row.conname = $1`,
      ["sellerProductImages_supported_format"],
    );
    assert.equal(ledger.rows[0]?.count, 2, "A refused constraint-only replay must preserve its prior ledger prefix.");
    assert.equal(constraint.rows.length, 1, "The already-present format constraint must remain untouched.");
  });
  console.log("PASS constraint-only migration: already-present constraint refused without ledger change");
}

async function testDataOnlyTargetGuard() {
  const name = await createTestDatabase("dataonly");
  await applyBaseline(name, true);
  await withClient(name, async (client) => {
    const pending = extractPendingMigrationObjects([
      { sql: ['UPDATE "users" SET "name" = \'migration-test\' WHERE "openId" = \'existing\';'] },
    ]);
    const existing = findAlreadyPresentPendingMigrationObjects(
      pending,
      await readPublicMigrationCatalog(client),
    );
    assert.deepEqual(existing, ["data-target:users"]);
  });
  await assertUserPreserved(name);
  console.log("PASS data-only mutation: preflight rejects an existing table as an unledgered target");
}

async function testSequenceOwnerMismatchRefusal() {
  const name = await createTestDatabase("sequenceowner");
  await applyBaseline(name, true);
  await withClient(name, async (client) => {
    await client.query('CREATE TABLE "sequenceOwnerProbe" ("id" integer PRIMARY KEY)');
    await client.query(
      'ALTER SEQUENCE "public"."users_id_seq" OWNED BY "public"."sequenceOwnerProbe"."id"',
    );
  });
  await expectRunnerFailure(name, "baseline does not match");
  await assertUserPreserved(name);
  await withClient(name, async (client) => {
    const { rows } = await client.query(
      `SELECT owner_table.relname AS table_name, owner_column.attname AS column_name
       FROM pg_class AS sequence
       JOIN pg_namespace AS ns ON ns.oid = sequence.relnamespace
       JOIN pg_depend AS dependency ON dependency.objid = sequence.oid AND dependency.deptype = 'a'
       JOIN pg_class AS owner_table ON owner_table.oid = dependency.refobjid
       JOIN pg_attribute AS owner_column
         ON owner_column.attrelid = owner_table.oid AND owner_column.attnum = dependency.refobjsubid
       WHERE ns.nspname = 'public' AND sequence.relname = 'users_id_seq'`,
    );
    assert.deepEqual(rows, [{ table_name: "sequenceOwnerProbe", column_name: "id" }]);
  });
  console.log("PASS sequence owner mismatch: exact baseline adoption refused and user data preserved");
}

async function testHistoryGapRefusal() {
  const name = await createTestDatabase("historygap");
  await applyBaseline(name, true);
  await withClient(name, async (client) => {
    await client.query('CREATE SCHEMA "drizzle"');
    await client.query(`
      CREATE TABLE "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    for (const index of [0, 2]) {
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
        [migrations[index].hash, migrations[index].folderMillis],
      );
    }
  });
  await expectRunnerFailure(name, "not an exact journal prefix");
  await assertUserPreserved(name);
  await withClient(name, async (client) => {
    const { rows } = await client.query('SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations"');
    assert.equal(rows[0]?.count, 2, "A refused history must remain unchanged.");
  });
  console.log("PASS journal gap: refusal without changing ledger or user data");
}

async function testConcurrentRunners() {
  const name = await createTestDatabase("concurrent");
  const results = await Promise.all([runMigrationRunner(name), runMigrationRunner(name)]);
  assert.ok(results.every((result) => result.ok), "Both concurrent migration runners should succeed.");
  await assertLedgerMatchesJournal(name);
  console.log("PASS concurrent runners: both succeeded and recorded each migration once");
}

try {
  await testFreshDatabaseAndSearchPath();
  await testPreAppliedBaselineAndDataPreservation();
  await testSchemaMismatchRefusal();
  await testSequenceOwnerMismatchRefusal();
  await testUnledgeredLaterMigrationRefusal();
  await testConstraintOnlyMigrationRefusal();
  await testDataOnlyTargetGuard();
  await testHistoryGapRefusal();
  await testConcurrentRunners();
  console.log(`PASS all local-only PostgreSQL migration integration checks (${migrations.length} journal entries)`);
} finally {
  for (const name of createdDatabases.reverse()) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`).catch(() => {});
  }
  await admin.end();
}
