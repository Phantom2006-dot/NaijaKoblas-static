import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL_UNPOOLED (preferred for migrations) or DATABASE_URL to run drizzle commands.");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/postgres",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
