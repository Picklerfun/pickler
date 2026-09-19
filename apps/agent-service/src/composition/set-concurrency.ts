import { PostgresResearchStore } from "@pickler/infrastructure";

/** Explicit operator action; never available through tenant or model tools. */
export async function setConcurrency(
  databaseUrl: string,
  globalLimit: number,
  tenantLimit: number,
) {
  const repository = new PostgresResearchStore(databaseUrl);
  try {
    await repository.setConcurrency(globalLimit, tenantLimit);
  } finally {
    await repository.close();
  }
}
