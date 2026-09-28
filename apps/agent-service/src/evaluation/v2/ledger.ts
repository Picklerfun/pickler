import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EvaluationFailure, fingerprint } from "../decision-evaluation";

export async function saveExclusive(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
}
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function existsJson(path: string): Promise<unknown | undefined> {
  try {
    return await readJson(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
export class CampaignLedger {
  constructor(
    readonly directory: string,
    readonly previousAccountedUsd: number,
  ) {}
  async accounting() {
    let calls = 0;
    let accountedUsd = 0;
    let unknownCharges = 0;
    for (const id of await readdir(resolve(this.directory, "requests"))) {
      const directory = resolve(this.directory, "requests", id);
      const started = (await existsJson(resolve(directory, "started.json"))) as
        { reservedUsd: number } | undefined;
      if (!started) {
        continue;
      }
      calls++;
      const completed = (await existsJson(resolve(directory, "completed.json"))) as
        { cost: number } | undefined;
      const amount = completed?.cost ?? started.reservedUsd;
      if (!Number.isFinite(amount) || amount < 0) {
        throw new EvaluationFailure("INVALID_LEDGER_AMOUNT");
      }
      accountedUsd += amount;
      if (!completed) {
        unknownCharges++;
      }
    }
    return { calls, accountedUsd, unknownCharges };
  }
  async reserve(caseId: string, variant: string, reservedUsd: number, metadata: unknown) {
    const current = await this.accounting();
    if (
      !Number.isFinite(reservedUsd) ||
      reservedUsd < 0 ||
      current.calls >= 176 ||
      current.accountedUsd + reservedUsd > 0.5 ||
      this.previousAccountedUsd + current.accountedUsd + reservedUsd > 1
    ) {
      throw new EvaluationFailure("V2_CAMPAIGN_BUDGET_OR_CALL_LIMIT");
    }
    const directory = resolve(this.directory, "requests", fingerprint({ caseId, variant }));
    await mkdir(directory, { mode: 0o700 });
    await saveExclusive(resolve(directory, "started.json"), {
      caseId,
      variant,
      reservedUsd,
      startedAt: new Date().toISOString(),
      metadata,
    });
    return directory;
  }
}

export async function historicalAccounting(directory: string): Promise<number> {
  let total = 0;
  let attempts: string[];
  try {
    attempts = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  for (const attempt of attempts) {
    const path = resolve(directory, attempt);
    for (const file of await readdir(path)) {
      if (!file.endsWith("-started.json")) {
        continue;
      }
      const started = (await readJson(resolve(path, file))) as { reservedUsd: number };
      const completed = (await existsJson(
        resolve(path, file.replace(/-started\.json$/, ".json")),
      )) as { estimatedCostUsd?: number } | undefined;
      const amount = completed?.estimatedCostUsd ?? started.reservedUsd;
      if (!Number.isFinite(amount) || amount < 0) {
        throw new EvaluationFailure("INVALID_HISTORICAL_ACCOUNTING");
      }
      total += amount;
    }
  }
  return total;
}
