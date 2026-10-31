import { describe, expect, it } from "vitest";
import {
  decideBaselineAdoption,
  extractBaselineObjects,
  validateMigrationHistory,
} from "./baselineAdoption";

const migrations = [
  { hash: "baseline-sha256", folderMillis: 1_700_000_000_000 },
  { hash: "gallery-sha256", folderMillis: 1_700_000_100_000 },
  { hash: "format-sha256", folderMillis: 1_700_000_200_000 },
] as const;
const baseline = migrations[0];
const expected = { enumNames: ["account_role", "product_status"], tableNames: ["users", "products"] };
const completeCatalog = {
  existingEnumNames: ["account_role", "product_status"],
  existingTableNames: ["users", "products"],
};

describe("PostgreSQL baseline adoption", () => {
  it("extracts the public enum and table names from Drizzle migration SQL", () => {
    expect(
      extractBaselineObjects([
        'CREATE TYPE "public"."account_role" AS ENUM(\'customer\', \'admin\');',
        'CREATE TABLE "users" ("id" serial PRIMARY KEY NOT NULL);',
      ]),
    ).toEqual({ enumNames: ["account_role"], tableNames: ["users"] });
  });

  it("lets Drizzle apply the baseline to a fresh database", () => {
    expect(
      decideBaselineAdoption(baseline, expected, {
        existingEnumNames: [],
        existingTableNames: [],
        ledgerRows: [],
      }),
    ).toBe("fresh");
  });

  it("adopts a fully present baseline only when the ledger is empty", () => {
    expect(
      decideBaselineAdoption(baseline, expected, {
        ...completeCatalog,
        ledgerRows: [],
      }),
    ).toBe("adopt");
  });

  it("does not write another baseline record when the exact record already exists", () => {
    const rows = [{ hash: baseline.hash, createdAt: String(baseline.folderMillis) }];
    expect(validateMigrationHistory(rows, migrations)).toBe(1);
    expect(
      decideBaselineAdoption(baseline, expected, {
        ...completeCatalog,
        ledgerRows: rows,
      }),
    ).toBe("already-recorded");
  });

  it("refuses to adopt a partial existing schema", () => {
    expect(() =>
      decideBaselineAdoption(baseline, expected, {
        existingEnumNames: ["account_role"],
        existingTableNames: ["users"],
        ledgerRows: [],
      }),
    ).toThrow(/only partially matches/i);
  });

  it("accepts only an exact ordered prefix of the migration journal", () => {
    expect(
      validateMigrationHistory(
        [
          { hash: migrations[0].hash, createdAt: String(migrations[0].folderMillis) },
          { hash: migrations[1].hash, createdAt: String(migrations[1].folderMillis) },
        ],
        migrations,
      ),
    ).toBe(2);
  });

  it("rejects a migration history gap where a later migration exists without its predecessor", () => {
    expect(() =>
      validateMigrationHistory(
        [
          { hash: migrations[0].hash, createdAt: migrations[0].folderMillis },
          { hash: migrations[2].hash, createdAt: migrations[2].folderMillis },
        ],
        migrations,
      ),
    ).toThrow(/not an exact journal prefix/i);
  });

  it("rejects duplicate, unknown or extra ledger rows", () => {
    expect(() =>
      validateMigrationHistory(
        [
          { hash: migrations[0].hash, createdAt: migrations[0].folderMillis },
          { hash: migrations[0].hash, createdAt: migrations[0].folderMillis },
        ],
        migrations,
      ),
    ).toThrow(/not an exact journal prefix/i);
    expect(() =>
      validateMigrationHistory(
        [
          { hash: migrations[0].hash, createdAt: migrations[0].folderMillis },
          { hash: "unrecognized", createdAt: 1_700_000_100_000 },
        ],
        migrations,
      ),
    ).toThrow(/not an exact journal prefix/i);
    const completeLedgerRows = migrations.map(({ hash, folderMillis }) => ({ hash, createdAt: folderMillis }));
    expect(() =>
      validateMigrationHistory(
        [...completeLedgerRows, { hash: "extra", createdAt: 1_700_000_300_000 }],
        migrations,
      ),
    ).toThrow(/more rows than/i);
  });

  it("refuses non-empty history without a matching baseline record", () => {
    expect(() =>
      decideBaselineAdoption(baseline, expected, {
        ...completeCatalog,
        ledgerRows: [{ hash: "different-hash", createdAt: 1_600_000_000_000 }],
      }),
    ).toThrow(/non-empty without a matching baseline/i);
  });

  it("refuses duplicate or conflicting baseline records", () => {
    expect(() =>
      decideBaselineAdoption(baseline, expected, {
        ...completeCatalog,
        ledgerRows: [
          { hash: baseline.hash, createdAt: baseline.folderMillis },
          { hash: baseline.hash, createdAt: baseline.folderMillis },
        ],
      }),
    ).toThrow(/ledger record conflicts/i);
    expect(() =>
      decideBaselineAdoption(baseline, expected, {
        ...completeCatalog,
        ledgerRows: [{ hash: "different-hash", createdAt: baseline.folderMillis }],
      }),
    ).toThrow(/ledger record conflicts/i);
  });
});
