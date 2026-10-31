import type { PoolClient } from "pg";
import type { BaselineObjects } from "./baselineAdoption";

function quoteGeneratedSchemaName(schemaName: string): string {
  if (!/^[_a-z][_a-z0-9]{0,45}$/i.test(schemaName)) {
    throw new Error("Unsafe internal schema name for baseline verification.");
  }
  return `"${schemaName}"`;
}

export async function schemaFingerprint(
  client: PoolClient,
  schemaName: string,
  expected: BaselineObjects,
): Promise<string> {
  const quotedSchemaName = quoteGeneratedSchemaName(schemaName);
  await client.query(`SET LOCAL search_path TO ${quotedSchemaName}`);

  const result = await client.query<{ fingerprint: string }>(
    `SELECT jsonb_build_object(
      'enums', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', enum_type.typname,
            'labels', COALESCE((
              SELECT jsonb_agg(enum_label.enumlabel ORDER BY enum_label.enumsortorder)
              FROM pg_enum AS enum_label
              WHERE enum_label.enumtypid = enum_type.oid
            ), '[]'::jsonb)
          ) ORDER BY enum_type.typname
        )
        FROM pg_type AS enum_type
        JOIN pg_namespace AS enum_schema ON enum_schema.oid = enum_type.typnamespace
        WHERE enum_schema.nspname = $1
          AND enum_type.typtype = 'e'
          AND enum_type.typname = ANY($2::text[])
      ), '[]'::jsonb),
      'tables', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', table_class.relname,
            'persistence', table_class.relpersistence,
            'columns', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', attribute.attname,
                  'type', format_type(attribute.atttypid, attribute.atttypmod),
                  'notNull', attribute.attnotnull,
                  'default', pg_get_expr(column_default.adbin, column_default.adrelid),
                  'identity', attribute.attidentity,
                  'generated', attribute.attgenerated
                ) ORDER BY attribute.attnum
              )
              FROM pg_attribute AS attribute
              LEFT JOIN pg_attrdef AS column_default
                ON column_default.adrelid = attribute.attrelid
               AND column_default.adnum = attribute.attnum
              WHERE attribute.attrelid = table_class.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
            ), '[]'::jsonb),
            'constraints', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', constraint_row.conname,
                  'type', constraint_row.contype,
                  'definition', pg_get_constraintdef(constraint_row.oid, true),
                  'deferrable', constraint_row.condeferrable,
                  'deferred', constraint_row.condeferred,
                  'validated', constraint_row.convalidated
                ) ORDER BY constraint_row.conname
              )
              FROM pg_constraint AS constraint_row
              WHERE constraint_row.conrelid = table_class.oid
            ), '[]'::jsonb),
            'indexes', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', index_class.relname,
                  'definition', replace(pg_get_indexdef(index_class.oid), quote_ident($1) || '.', '')
                ) ORDER BY index_class.relname
              )
              FROM pg_index AS index_row
              JOIN pg_class AS index_class ON index_class.oid = index_row.indexrelid
              WHERE index_row.indrelid = table_class.oid
            ), '[]'::jsonb),
            'sequences', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', sequence_class.relname,
                  'ownerColumn', owner_attribute.attname,
                  'type', format_type(sequence_info.seqtypid, NULL),
                  'start', sequence_info.seqstart::text,
                  'increment', sequence_info.seqincrement::text,
                  'minimum', sequence_info.seqmin::text,
                  'maximum', sequence_info.seqmax::text,
                  'cache', sequence_info.seqcache::text,
                  'cycle', sequence_info.seqcycle
                ) ORDER BY sequence_class.relname
              )
              FROM pg_depend AS ownership
              JOIN pg_class AS sequence_class
                ON sequence_class.oid = ownership.objid
               AND sequence_class.relkind = 'S'
              JOIN pg_namespace AS sequence_schema ON sequence_schema.oid = sequence_class.relnamespace
              JOIN pg_sequence AS sequence_info ON sequence_info.seqrelid = sequence_class.oid
              JOIN pg_attribute AS owner_attribute
                ON owner_attribute.attrelid = ownership.refobjid
               AND owner_attribute.attnum = ownership.refobjsubid
              WHERE ownership.refobjid = table_class.oid
                AND ownership.refobjsubid > 0
                AND ownership.deptype IN ('a', 'i')
                AND sequence_schema.nspname = $1
            ), '[]'::jsonb)
          ) ORDER BY table_class.relname
        )
        FROM pg_class AS table_class
        JOIN pg_namespace AS table_schema ON table_schema.oid = table_class.relnamespace
        WHERE table_schema.nspname = $1
          AND table_class.relkind = 'r'
          AND table_class.relname = ANY($3::text[])
      ), '[]'::jsonb)
    )::text AS fingerprint`,
    [schemaName, expected.enumNames, expected.tableNames],
  );

  const fingerprint = result.rows[0]?.fingerprint;
  if (!fingerprint) throw new Error(`Could not fingerprint PostgreSQL schema ${schemaName}.`);
  return fingerprint;
}

export async function assertExistingBaselineMatches(
  client: PoolClient,
  baselineSql: readonly string[],
  expected: BaselineObjects,
): Promise<void> {
  // The caller holds the migration transaction and advisory lock. Any error will roll back this scratch schema.
  const scratchSchema = `nk_baseline_${process.pid}_${Math.floor(Math.random() * 1_000_000)}`;
  const quotedScratchSchema = quoteGeneratedSchemaName(scratchSchema);
  await client.query(`CREATE SCHEMA ${quotedScratchSchema}`);

  try {
    await client.query(`SET LOCAL search_path TO ${quotedScratchSchema}`);
    for (const statement of baselineSql) {
      const rewritten = statement.replaceAll('"public".', `${quotedScratchSchema}.`);
      await client.query(rewritten);
    }

    const expectedFingerprint = await schemaFingerprint(client, scratchSchema, expected);
    const actualFingerprint = await schemaFingerprint(client, "public", expected);
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error(
        "The pre-existing PostgreSQL baseline does not match its migration definitions; refusing to adopt or continue.",
      );
    }
  } finally {
    await client.query(`DROP SCHEMA ${quotedScratchSchema} CASCADE`).catch(() => {});
  }
}
