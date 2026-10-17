import { z } from "zod";
import type { BaselineDatabaseSnapshot } from "@pickler/infrastructure/trading-baseline";

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
export const toolsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native"), directory: z.string().startsWith("/") }).strict(),
  z.object({ kind: z.literal("docker"), container: id }).strict(),
]);
export const databaseOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct-local") }).strict(),
  z
    .object({
      kind: z.literal("stopped-volume-copy"),
      originalContainer: id,
      originalVolume: id,
      originalPort: z.number().int().min(1).max(65535),
      originalSystemIdentifier: z.string().regex(/^\d+$/),
      evidenceRoot: id,
    })
    .strict(),
]);
export const inventorySchema = z
  .object({
    protocol: z.literal("trading-baseline-inventory-v1"),
    repository: z.string().startsWith("/"),
    ptsPath: z.string(),
    candidatePath: z.string(),
    references: z
      .array(
        z
          .object({
            name: z.string().regex(/^refs\/(tags|heads)\/[a-zA-Z0-9._/-]+$/),
            commit,
            annotated: z.boolean(),
          })
          .strict(),
      )
      .min(3),
    roots: z.array(z.object({ id, path: z.string().startsWith("/") }).strict()).min(1),
    files: z.array(
      z
        .object({
          root: id,
          path: z.string(),
          sha256: hashSchema.nullable(),
          bytes: z.number().int().nonnegative().nullable(),
          mtimeMs: z.number().nullable(),
        })
        .strict(),
    ),
    databases: z.array(
      z
        .object({
          id,
          envFile: z.string().startsWith("/"),
          tools: toolsSchema,
          configurationFiles: z.array(z.string()),
          origin: databaseOriginSchema.optional(),
        })
        .strict(),
    ),
    unavailable: z.array(
      z
        .object({
          kind: z.enum(["file", "directory", "database", "configuration"]),
          source: z.string(),
          code: id,
        })
        .strict(),
    ),
  })
  .strict();
export type BaselineInventory = z.infer<typeof inventorySchema>;
export interface BaselineFile {
  root: string;
  path: string;
  source: string;
  status: "copied" | "excluded" | "unavailable" | "changed";
  reason: string | null;
  capturedAt: string;
  sha256: string | null;
  bytes: number | null;
  artifact: string | null;
  opaquePrivate: boolean;
}
export interface BaselineArtifact {
  path: string;
  sha256: string;
  bytes: number;
}
export interface BaselineManifest {
  protocol: "trading-baseline-v1";
  version: 1;
  captureId: string;
  capturedAt: string;
  completedAt: string;
  exportCommit: string;
  status: "complete" | "partial";
  consistency: "Per database snapshot; files individually verified. No global common instant.";
  recoveryOnly: true;
  pts: {
    bundleId: "pts-course";
    knowledgeVersion: "1.0.0";
    bundleSha256: string;
    candidateSha256: string;
    validation: unknown;
  };
  git: { bundle: BaselineArtifact; references: BaselineInventory["references"] };
  roots: BaselineInventory["roots"];
  files: BaselineFile[];
  databases: {
    id: string;
    configurationFiles: string[];
    origin: z.infer<typeof databaseOriginSchema>;
    status: "captured" | "unavailable";
    code: string | null;
    snapshot: BaselineDatabaseSnapshot | null;
    dump: BaselineArtifact | null;
    inventory: BaselineArtifact | null;
  }[];
  unavailable: BaselineInventory["unavailable"];
  verification: { status: "pending"; restoration: "pending" };
}
export interface BaselineSeal {
  protocol: "trading-baseline-seal-v1";
  manifest: BaselineArtifact;
}
export interface BaselineVerification {
  protocol: "trading-baseline-verification-v1";
  verifierCommit: string;
  captureId: string;
  status: "verified" | "failed";
  completeness: "complete" | "partial";
  filesChecked: number;
  databasesChecked: number;
  failures: string[];
}

const artifact = z
  .object({ path: z.string(), sha256: hashSchema, bytes: z.number().int().nonnegative() })
  .strict();
const snapshot = z
  .object({
    version: z.literal(1),
    identity: z
      .object({
        host: z.enum(["localhost", "127.0.0.1", "[::1]"]),
        port: z.number().int().min(1).max(65535),
        database: id,
        systemIdentifier: z.string().regex(/^\d+$/),
        serverVersion: z.string(),
      })
      .strict(),
    capturedAt: z.string().datetime(),
    snapshot: z.string(),
    tables: z.array(
      z
        .object({
          schema: z.string(),
          name: z.string(),
          rows: z.number().int().nonnegative(),
          rowsSha256: hashSchema,
          columns: z.array(z.unknown()),
        })
        .strict(),
    ),
    sequences: z.array(
      z
        .object({
          schema: z.string(),
          name: z.string(),
          lastValue: z.string().nullable(),
          isCalled: z.boolean(),
        })
        .strict(),
    ),
    roles: z.array(z.string()),
    studies: z.array(z.object({ table: z.string(), ids: z.array(z.string()) }).strict()),
    inventorySha256: hashSchema,
    consistency: z.literal("per-database-repeatable-read-shared-with-pg-dump"),
  })
  .strict();
export const manifestSchema = z
  .object({
    protocol: z.literal("trading-baseline-v1"),
    version: z.literal(1),
    captureId: id,
    capturedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    exportCommit: commit,
    status: z.enum(["complete", "partial"]),
    consistency: z.literal(
      "Per database snapshot; files individually verified. No global common instant.",
    ),
    recoveryOnly: z.literal(true),
    pts: z
      .object({
        bundleId: z.literal("pts-course"),
        knowledgeVersion: z.literal("1.0.0"),
        bundleSha256: hashSchema,
        candidateSha256: hashSchema,
        validation: z.unknown(),
      })
      .strict(),
    git: z.object({ bundle: artifact, references: inventorySchema.shape.references }).strict(),
    roots: inventorySchema.shape.roots,
    files: z.array(
      z
        .object({
          root: id,
          path: z.string(),
          source: z.string(),
          status: z.enum(["copied", "excluded", "unavailable", "changed"]),
          reason: z.string().nullable(),
          capturedAt: z.string().datetime(),
          sha256: hashSchema.nullable(),
          bytes: z.number().int().nonnegative().nullable(),
          artifact: z.string().nullable(),
          opaquePrivate: z.boolean(),
        })
        .strict(),
    ),
    databases: z.array(
      z
        .object({
          id,
          configurationFiles: z.array(z.string()),
          origin: databaseOriginSchema,
          status: z.enum(["captured", "unavailable"]),
          code: z.string().nullable(),
          snapshot: snapshot.nullable(),
          dump: artifact.nullable(),
          inventory: artifact.nullable(),
        })
        .strict(),
    ),
    unavailable: inventorySchema.shape.unavailable,
    verification: z
      .object({ status: z.literal("pending"), restoration: z.literal("pending") })
      .strict(),
  })
  .strict();
export const sealSchema = z
  .object({ protocol: z.literal("trading-baseline-seal-v1"), manifest: artifact })
  .strict();
