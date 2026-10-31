import { describe, expect, it } from "vitest";
import {
  extractPendingMigrationObjects,
  findAlreadyPresentPendingMigrationObjects,
} from "./pendingObjects";

describe("pending PostgreSQL migration preflight", () => {
  it("extracts relations, index, enum, constraint and data targets", () => {
    expect(
      extractPendingMigrationObjects([
        {
          sql: [
            'CREATE TABLE "newImages" ("id" serial PRIMARY KEY);',
            'CREATE TYPE "public"."new_status" AS ENUM(\'pending\', \'done\');',
            'ALTER TABLE "newImages" ADD CONSTRAINT "newImages_check" CHECK ("id" > 0);',
            'CREATE UNIQUE INDEX "newImages_unique" ON "newImages" USING btree ("id");',
            'CREATE SEQUENCE "legacySequence";',
            'INSERT INTO "newImages" ("id") VALUES (1);',
          ],
        },
      ]),
    ).toEqual({
      tableNames: ["newImages"],
      enumNames: ["new_status"],
      indexNames: ["newImages_unique"],
      sequenceNames: ["legacySequence"],
      constraints: [{ tableName: "newImages", name: "newImages_check" }],
      dataMutationTargets: ["newImages"],
    });
  });

  it("identifies already-present unledgered objects and data targets", () => {
    const pending = extractPendingMigrationObjects([
      {
        sql: [
          'CREATE TABLE "newImages" ("id" serial PRIMARY KEY);',
          'CREATE INDEX "newImages_idx" ON "newImages" USING btree ("id");',
          'INSERT INTO "users" ("email") VALUES (\'test@example.invalid\');',
        ],
      },
    ]);

    expect(
      findAlreadyPresentPendingMigrationObjects(pending, {
        tableNames: ["newImages", "users"],
        enumNames: [],
        indexNames: ["newImages_idx"],
        sequenceNames: [],
        constraints: [],
      }),
    ).toEqual(["table:newImages", "index:newImages_idx", "data-target:users"]);
  });

  it("permits a fresh pending migration while none of its objects/data targets exist", () => {
    const pending = extractPendingMigrationObjects([
      { sql: ['CREATE TABLE "newImages" ("id" serial PRIMARY KEY);', 'INSERT INTO "newImages" ("id") VALUES (1);'] },
    ]);
    expect(
      findAlreadyPresentPendingMigrationObjects(pending, {
        tableNames: [],
        enumNames: [],
        indexNames: [],
        sequenceNames: [],
        constraints: [],
      }),
    ).toEqual([]);
  });

  it("detects a pre-existing constraint from a constraint-only migration", () => {
    const pending = extractPendingMigrationObjects([
      { sql: ['ALTER TABLE "sellerProductImages" ADD CONSTRAINT "supported_format" CHECK ("format" IN (\'jpg\', \'png\'));'] },
    ]);
    expect(
      findAlreadyPresentPendingMigrationObjects(pending, {
        tableNames: ["sellerProductImages"],
        enumNames: [],
        indexNames: [],
        sequenceNames: [],
        constraints: [{ tableName: "sellerProductImages", name: "supported_format" }],
      }),
    ).toEqual(["constraint:sellerProductImages.supported_format"]);
  });

  it("does not split on semicolons inside quoted SQL values", () => {
    expect(
      extractPendingMigrationObjects([
        { sql: ['INSERT INTO "users" ("email") VALUES (\'semicolon;inside@example.invalid\');'] },
      ]).dataMutationTargets,
    ).toEqual(["users"]);
  });

  it("fails closed on statement grammars that need an explicit reviewed parser rule", () => {
    for (const statement of [
      'ALTER TABLE "users" ADD COLUMN "newColumn" text;',
      'ALTER TYPE "account_role" ADD VALUE \'auditor\';',
      'CREATE INDEX CONCURRENTLY "users_email_idx" ON "users" ("email");',
      'UPDATE users SET email = \'updated@example.invalid\';',
      'CREATE TABLE "x" ("id" integer); DROP TABLE "users";',
      'UPDATE "users" SET "name" = \'x\'; DROP TABLE "users";',
      'ALTER TABLE "x" ADD CONSTRAINT "c" CHECK (true) USING INDEX "i";',
    ]) {
      expect(() => extractPendingMigrationObjects([{ sql: [statement] }])).toThrow(
        "Unsupported PostgreSQL migration statement",
      );
    }
  });
});
