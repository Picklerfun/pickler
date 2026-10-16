import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, statfs } from "node:fs/promises";
import { createHash, randomUUID, type Hash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { PilotError } from "@pickler/core";

export const BREAKOUT_BYTES = {
  wirePrefix: 32 * 1024 * 1024,
  part: 64 * 1024 * 1024,
  all: 16 * 1024 * 1024 * 1024,
  free: 20 * 1024 * 1024 * 1024,
} as const;

export function bytesHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digest(value: unknown): string {
  return bytesHash(JSON.stringify(value));
}

export function checkoutCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export function requireCleanCheckout(): void {
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
    throw new PilotError("DIRTY_CHECKOUT", "Freeze a clean tested commit before public capture");
  }
}

/** Reservations are synchronous on the host, including messages from its one report worker. */
export class ArtifactBudget {
  private used: number;
  private reserved = 0;

  constructor(
    initial = 0,
    readonly limit = BREAKOUT_BYTES.all,
  ) {
    if (!Number.isSafeInteger(initial) || initial < 0 || initial > limit) {
      throw new PilotError("BREAKOUT_ARTIFACT_LIMIT", "Invalid initial artifact byte inventory");
    }
    this.used = initial;
  }

  reserve(bytes: number): () => void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.used + this.reserved + bytes > this.limit
    ) {
      throw new PilotError("BREAKOUT_ARTIFACT_LIMIT", "All-artifact byte ceiling reached");
    }
    this.reserved += bytes;
    let active = true;
    return () => {
      if (active) {
        active = false;
        this.reserved -= bytes;
        this.used += bytes;
      }
    };
  }

  release(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.used) {
      throw new PilotError("BREAKOUT_ARTIFACT_LIMIT", "Invalid artifact removal accounting");
    }
    this.used -= bytes;
  }

  snapshot() {
    return { usedBytes: this.used, reservedBytes: this.reserved, limitBytes: this.limit };
  }
}

export interface ArtifactWriter {
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export function budgetWriter(budget: ArtifactBudget): ArtifactWriter {
  return {
    async write(path, bytes) {
      const commit = budget.reserve(bytes.byteLength);
      let handle;
      try {
        handle = await open(path, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle?.close();
        // A partial failed file consumes its complete reservation until explicit removal.
        commit();
      }
    },
    async remove(path) {
      const size = (await lstat(path)).size;
      await rm(path);
      budget.release(size);
    },
  };
}

export async function newDirectory(path: string | undefined): Promise<string> {
  if (!path) {
    throw new PilotError("INVALID_INPUT", "A new --output directory is required");
  }
  const directory = resolve(path);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    throw new PilotError("BREAKOUT_OUTPUT_EXISTS", "Output must be a new directory");
  }
  return directory;
}

export async function inventoryBytes(root: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new PilotError("BREAKOUT_UNSAFE_PATH", "Artifact inventory forbids symbolic links");
    }
    bytes += entry.isDirectory() ? await inventoryBytes(path) : (await lstat(path)).size;
  }
  return bytes;
}

export async function requireFreeSpace(root: string, minimum = BREAKOUT_BYTES.free) {
  const info = await statfs(root);
  const availableBytes = Number(info.bavail) * Number(info.bsize);
  if (!Number.isSafeInteger(availableBytes) || availableBytes < minimum) {
    throw new PilotError(
      "BREAKOUT_FREE_SPACE",
      `At least ${minimum} bytes of free space are required before capture`,
    );
  }
  return { availableBytes, minimumBytes: minimum };
}

export async function atomicJson(
  directory: string,
  name: string,
  value: unknown,
  writer: ArtifactWriter,
) {
  const path = join(directory, name);
  const temporary = join(directory, `.${name}-${randomUUID()}.tmp`);
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  await writer.write(temporary, bytes);
  let oldBytes = 0;
  try {
    oldBytes = (await lstat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await rename(temporary, path);
  return { bytes: bytes.byteLength, replacedBytes: oldBytes };
}

export interface JournalPart {
  file: string;
  bytes: number;
  sha256: string;
  records: number;
}

/** Original journals are append-only, bounded parts with verifiable read-only prefix snapshots. */
export class SegmentedJournal {
  private fd: number | undefined;
  private hash: Hash | undefined;
  private currentBytes = 0;
  private records = 0;
  private closedParts: JournalPart[] = [];
  private path = "";

  constructor(
    readonly directory: string,
    readonly prefix: string,
    private readonly budget: ArtifactBudget,
    private readonly partLimit = BREAKOUT_BYTES.part,
  ) {
    if (!/^[a-z][a-z0-9-]*$/.test(prefix)) {
      throw new PilotError("BREAKOUT_UNSAFE_PATH", "Journal prefix is not allowlisted");
    }
  }

  append(value: unknown, synchronize = true): { part: string; offset: number; bytes: number } {
    const bytes = Buffer.from(JSON.stringify(value) + "\n");
    if (bytes.byteLength > this.partLimit) {
      throw new PilotError(
        "BREAKOUT_SNAPSHOT_LIMIT",
        "An original journal record exceeds its part",
      );
    }
    const commit = this.budget.reserve(bytes.byteLength);
    try {
      if (this.fd === undefined || this.currentBytes + bytes.byteLength > this.partLimit) {
        this.seal();
        this.path = join(
          this.directory,
          `${this.prefix}-${String(this.closedParts.length).padStart(6, "0")}.jsonl`,
        );
        this.fd = openSync(this.path, "wx", 0o600);
        this.hash = createHash("sha256");
      }
      const offset = this.currentBytes;
      let written = 0;
      while (written < bytes.byteLength) {
        written += writeSync(this.fd, bytes, written, bytes.byteLength - written);
      }
      if (synchronize) {
        fsyncSync(this.fd);
      }
      this.hash!.update(bytes);
      this.currentBytes += bytes.byteLength;
      this.records++;
      return { part: basename(this.path), offset, bytes: bytes.byteLength };
    } finally {
      commit();
    }
  }

  snapshot(): JournalPart[] {
    const parts = [...this.closedParts];
    if (this.fd !== undefined) {
      fsyncSync(this.fd);
      parts.push({
        file: basename(this.path),
        bytes: this.currentBytes,
        sha256: this.hash!.copy().digest("hex"),
        records: this.records,
      });
    }
    return parts;
  }

  seal(): void {
    if (this.fd === undefined) {
      return;
    }
    fsyncSync(this.fd);
    closeSync(this.fd);
    this.closedParts.push({
      file: basename(this.path),
      bytes: this.currentBytes,
      sha256: this.hash!.digest("hex"),
      records: this.records,
    });
    this.fd = undefined;
    this.hash = undefined;
    this.currentBytes = 0;
    this.records = 0;
  }
}

export async function boundedJson(path: string, maximum = 1024 * 1024): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum) {
    throw new PilotError("INVALID_INPUT", "Bounded regular JSON file required");
  }
  const value = await readFile(path, "utf8");
  const after = await lstat(path);
  if (info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs) {
    throw new PilotError("BREAKOUT_HASH_MISMATCH", "JSON input changed while reading");
  }
  return JSON.parse(value);
}
