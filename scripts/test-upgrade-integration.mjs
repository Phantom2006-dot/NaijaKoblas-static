import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const exec = promisify(execFile);
const { Client } = pg;
const root = process.cwd();
const maintenance = process.env.KOBLAS_TEST_DATABASE_URL;
if (!maintenance) throw new Error("Set KOBLAS_TEST_DATABASE_URL to a localhost PostgreSQL maintenance URL ending in /postgres. Production DATABASE_URL is never used.");
const url = new URL(maintenance);
assert.ok(["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase()), "Remote PostgreSQL hosts are forbidden.");
assert.equal(url.pathname, "/postgres", "Use the local /postgres maintenance database.");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Expected PostgreSQL URL.");
const suites = {
  products: "server/admin/products.integration.ts",
  operations: "server/admin/operations.integration.ts",
  submissions: "server/publicSubmissions.integration.ts",
};
const selected = process.argv.slice(2);
const names = selected.length ? selected : Object.keys(suites);
for (const name of names) {
  assert.ok(Object.hasOwn(suites, name), `Unknown suite: ${name}`);
  assert.ok(existsSync(path.join(root, suites[name])), `Missing integration script: ${suites[name]}`);
}
const run = async (command, args, env) => {
  try {
    const result = await exec(command, args, { cwd: root, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result;
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw new Error(`Command failed: ${command} ${args.join(" ")}`, { cause: error });
  }
};
await run("pnpm", ["exec", "esbuild", "server/migrations/run.ts", "--platform=node", "--packages=external", "--bundle", "--format=esm", "--outfile=dist/migrations/run.js"], process.env);
const admin = new Client({ connectionString: maintenance });
await admin.connect();
try {
  for (const suite of names) {
    const database = `koblas_upgrade_${randomBytes(6).toString("hex")}_${suite}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    const scoped = new URL(maintenance);
    scoped.pathname = `/${database}`;
    const env = {
      ...process.env,
      DATABASE_URL: scoped.toString(),
      DATABASE_URL_UNPOOLED: scoped.toString(),
      NODE_ENV: "test",
      CLERK_SECRET_KEY: "",
      CLERK_PUBLISHABLE_KEY: "",
      OWNER_CLERK_USER_ID: "",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
      PAYSTACK_SECRET_KEY: "",
    };
    console.log(`\nStarting disposable ${suite} persistence check (no remote writes).`);
    try {
      await run(process.execPath, ["dist/migrations/run.js"], env);
      await run(process.execPath, ["dist/migrations/run.js"], env);
      await run("pnpm", ["exec", "tsx", suites[suite]], env);
      console.log(`PASS ${suite}: migrated twice and tested actual database persistence.`);
    } finally {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
      await admin.query(`DROP DATABASE "${database}"`);
    }
  }
} finally {
  await admin.end();
}
console.log("PASS all selected isolated upgrade integration suites; temporary databases removed.");
