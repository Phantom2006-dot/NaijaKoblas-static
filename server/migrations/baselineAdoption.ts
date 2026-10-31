export type MigrationLedgerRow = {
  hash: string;
  createdAt: string | number;
};

export type BaselineObjects = {
  enumNames: string[];
  tableNames: string[];
};

export type BaselineCatalog = {
  existingEnumNames: readonly string[];
  existingTableNames: readonly string[];
  ledgerRows: readonly MigrationLedgerRow[];
};

export type BaselineMigration = {
  hash: string;
  folderMillis: number;
};

export type BaselineAdoptionDecision = "fresh" | "adopt" | "already-recorded";

export function extractBaselineObjects(sqlStatements: readonly string[]): BaselineObjects {
  const sql = sqlStatements.join("\n");
  const enumNames = [...sql.matchAll(/\bCREATE\s+TYPE\s+"public"\."([^"]+)"\s+AS\s+ENUM\b/gi)].map(
    ([, name]) => name,
  );
  const tableNames = [...sql.matchAll(/\bCREATE\s+TABLE\s+"([^"]+)"\s*\(/gi)].map(([, name]) => name);

  if (enumNames.length === 0 || tableNames.length === 0) {
    throw new Error("The initial PostgreSQL migration does not declare the expected public enums and tables.");
  }

  return {
    enumNames: [...new Set(enumNames)],
    tableNames: [...new Set(tableNames)],
  };
}

export function validateMigrationHistory(
  ledgerRows: readonly MigrationLedgerRow[],
  migrations: readonly BaselineMigration[],
): number {
  if (ledgerRows.length > migrations.length) {
    throw new Error("The Drizzle migration ledger contains more rows than the current migration journal.");
  }

  for (const [index, row] of ledgerRows.entries()) {
    const expected = migrations[index];
    if (!expected || row.hash !== expected.hash || Number(row.createdAt) !== expected.folderMillis) {
      throw new Error(`The Drizzle migration ledger is not an exact journal prefix at position ${index + 1}.`);
    }
  }

  return ledgerRows.length;
}

export function decideBaselineAdoption(
  baseline: BaselineMigration,
  expected: BaselineObjects,
  catalog: BaselineCatalog,
): BaselineAdoptionDecision {
  if (expected.enumNames.length === 0 || expected.tableNames.length === 0) {
    throw new Error("Cannot verify baseline adoption without expected public enums and tables.");
  }

  const existingEnums = new Set(catalog.existingEnumNames);
  const existingTables = new Set(catalog.existingTableNames);
  const enumCount = expected.enumNames.filter((name) => existingEnums.has(name)).length;
  const tableCount = expected.tableNames.filter((name) => existingTables.has(name)).length;
  const anyBaselineObjectsExist = enumCount > 0 || tableCount > 0;
  const allBaselineObjectsExist =
    enumCount === expected.enumNames.length && tableCount === expected.tableNames.length;

  const baselineRows = catalog.ledgerRows.filter(
    (row) => row.hash === baseline.hash || Number(row.createdAt) === baseline.folderMillis,
  );
  if (baselineRows.length > 0) {
    const hasSingleExactBaselineRecord =
      baselineRows.length === 1 &&
      baselineRows[0].hash === baseline.hash &&
      Number(baselineRows[0].createdAt) === baseline.folderMillis;
    if (!hasSingleExactBaselineRecord || !allBaselineObjectsExist) {
      throw new Error("Drizzle's baseline ledger record conflicts with the current migration or database schema.");
    }
    return "already-recorded";
  }

  if (!anyBaselineObjectsExist) {
    if (catalog.ledgerRows.length > 0) {
      throw new Error("The migration ledger is non-empty but has no record for the initial PostgreSQL baseline.");
    }
    return "fresh";
  }

  if (!allBaselineObjectsExist) {
    throw new Error(
      "The existing PostgreSQL schema only partially matches the initial baseline; refusing to change migration history.",
    );
  }

  if (catalog.ledgerRows.length > 0) {
    throw new Error("The baseline schema exists but the migration ledger is non-empty without a matching baseline record.");
  }

  return "adopt";
}
