import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL for migrations.");

const migrationsFolder = fileURLToPath(new URL("../../drizzle/postgres", import.meta.url));
const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 5_000,
});

try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("[Migrations] PostgreSQL migrations applied.");
} finally {
  await pool.end();
}
