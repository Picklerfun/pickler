import type { LandingSnapshot } from "../domain/landing.js";

export interface LandingReadModel {
  /** Rejects with DataSourceUnavailableError when the source cannot answer. */
  getSnapshot(): Promise<LandingSnapshot>;
}
