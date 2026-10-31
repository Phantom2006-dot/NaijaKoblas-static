export type PendingMigrationSource = {
  sql: readonly string[];
};

export type PendingMigrationObjects = {
  tableNames: string[];
  enumNames: string[];
  indexNames: string[];
  sequenceNames: string[];
  constraints: Array<{ tableName: string; name: string }>;
  dataMutationTargets: string[];
};

export type PublicMigrationObjectCatalog = {
  tableNames: readonly string[];
  enumNames: readonly string[];
  indexNames: readonly string[];
  sequenceNames: readonly string[];
  constraints: readonly { tableName: string; name: string }[];
};

function unsupportedMigrationStatement(): Error {
  return new Error(
    "Unsupported PostgreSQL migration statement in replay preflight; add an explicit parser rule and tests before deploying this migration.",
  );
}

function stripOneStatementTerminator(rawStatement: string): string {
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarQuote: string | undefined;

  for (let index = 0; index < rawStatement.length; index += 1) {
    const character = rawStatement[index];
    const next = rawStatement[index + 1];

    if (dollarQuote) {
      if (rawStatement.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = undefined;
      }
      continue;
    }

    if (singleQuoted) {
      if (character === "'" && next === "'") {
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }

    if (doubleQuoted) {
      if (character === '"' && next === '"') {
        index += 1;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if ((character === "-" && next === "-") || (character === "/" && next === "*")) {
      throw unsupportedMigrationStatement();
    }

    if (character === "$") {
      const delimiter = rawStatement.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (delimiter) {
        dollarQuote = delimiter;
        index += delimiter.length - 1;
        continue;
      }
    }

    if (character === "'") {
      singleQuoted = true;
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      continue;
    }
    if (character === ";") {
      if (rawStatement.slice(index + 1).trim()) throw unsupportedMigrationStatement();
      return rawStatement.slice(0, index).trim();
    }
  }

  if (singleQuoted || doubleQuoted || dollarQuote) throw unsupportedMigrationStatement();
  return rawStatement.trim();
}

/**
 * Parse only the quoted PostgreSQL forms emitted by the current Drizzle migrations.
 * Unknown grammar, comments, and multiple top-level commands deliberately fail closed;
 * extend this parser and its tests before introducing a new migration statement shape.
 */
export function extractPendingMigrationObjects(
  migrations: readonly PendingMigrationSource[],
): PendingMigrationObjects {
  const tableNames = new Set<string>();
  const enumNames = new Set<string>();
  const indexNames = new Set<string>();
  const sequenceNames = new Set<string>();
  const constraints: Array<{ tableName: string; name: string }> = [];
  const dataMutationTargets = new Set<string>();

  for (const migration of migrations) {
    for (const rawStatement of migration.sql) {
      const statement = stripOneStatementTerminator(rawStatement);
      if (!statement) continue;

      let match = statement.match(/^CREATE\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s*\(/i);
      if (match) {
        if (!statement.endsWith(")")) throw unsupportedMigrationStatement();
        tableNames.add(match[1]);
        continue;
      }

      match = statement.match(/^CREATE\s+TYPE\s+"public"\."([^"]+)"\s+AS\s+ENUM\b/i);
      if (match) {
        if (!statement.endsWith(")")) throw unsupportedMigrationStatement();
        enumNames.add(match[1]);
        continue;
      }

      match = statement.match(
        /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+(?:"public"\.)?"([^"]+)"\s+USING\s+btree\s+\(([^()]*)\)(?:\s+WHERE\s+[\s\S]+)?$/i,
      );
      if (match) {
        if (!/^\s*"[^"]+"(?:\s*,\s*"[^"]+")*\s*$/.test(match[3])) {
          throw unsupportedMigrationStatement();
        }
        indexNames.add(match[1]);
        continue;
      }

      match = statement.match(/^CREATE\s+SEQUENCE\s+(?:"public"\.)?"([^"]+)"$/i);
      if (match) {
        sequenceNames.add(match[1]);
        continue;
      }

      match = statement.match(
        /^ALTER\s+TABLE\s+(?:"public"\.)?"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+(?:FOREIGN\s+KEY|CHECK|UNIQUE|PRIMARY\s+KEY)\b[\s\S]+$/i,
      );
      if (match) {
        if (/\b(?:USING\s+INDEX|NOT\s+VALID|DEFERRABLE)\b/i.test(statement)) {
          throw unsupportedMigrationStatement();
        }
        constraints.push({ tableName: match[1], name: match[2] });
        continue;
      }

      match = statement.match(
        /^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+(?:"public"\.)?"([^"]+)"(?:\s|\(|$)/i,
      );
      if (match) {
        dataMutationTargets.add(match[1]);
        continue;
      }

      throw unsupportedMigrationStatement();
    }
  }

  return {
    tableNames: [...tableNames],
    enumNames: [...enumNames],
    indexNames: [...indexNames],
    sequenceNames: [...sequenceNames],
    constraints,
    dataMutationTargets: [...dataMutationTargets],
  };
}

export function findAlreadyPresentPendingMigrationObjects(
  pending: PendingMigrationObjects,
  catalog: PublicMigrationObjectCatalog,
): string[] {
  const existingTables = new Set(catalog.tableNames);
  const existingEnums = new Set(catalog.enumNames);
  const existingIndexes = new Set(catalog.indexNames);
  const existingSequences = new Set(catalog.sequenceNames);
  const existingConstraints = new Set(
    catalog.constraints.map(({ tableName, name }) => `${tableName}\0${name}`),
  );
  const pendingTables = new Set(pending.tableNames);
  const matches: string[] = [];

  for (const name of pending.tableNames) if (existingTables.has(name)) matches.push(`table:${name}`);
  for (const name of pending.enumNames) if (existingEnums.has(name)) matches.push(`enum:${name}`);
  for (const name of pending.indexNames) if (existingIndexes.has(name)) matches.push(`index:${name}`);
  for (const name of pending.sequenceNames) if (existingSequences.has(name)) matches.push(`sequence:${name}`);
  for (const { tableName, name } of pending.constraints) {
    if (existingConstraints.has(`${tableName}\0${name}`)) matches.push(`constraint:${tableName}.${name}`);
  }
  for (const tableName of pending.dataMutationTargets) {
    if (existingTables.has(tableName) && !pendingTables.has(tableName)) {
      matches.push(`data-target:${tableName}`);
    }
  }

  return [...new Set(matches)];
}
