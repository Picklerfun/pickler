import { PostgresResearchStore } from "@pickler/infrastructure";
import { assertControlledDatabase, assertControlledDatabaseUrl } from "./fixture-isolation.js";

/** Test-only boundary: validate dedicated storage before invoking production mutations. */
export class ControlledResearchStore extends PostgresResearchStore {
  constructor(
    connectionString: string,
    private readonly identity: string | undefined,
  ) {
    assertControlledDatabaseUrl(connectionString);
    super(connectionString, undefined, { environment: "local" });
  }

  override async claim(now: number) {
    await assertControlledDatabase(this.pool, this.identity);
    return super.claim(now);
  }

  override async recover(now: number) {
    await assertControlledDatabase(this.pool, this.identity);
    return super.recover(now);
  }

  override async tick(now: number) {
    await assertControlledDatabase(this.pool, this.identity);
    return super.tick(now);
  }
}
