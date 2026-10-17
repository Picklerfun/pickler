import type { AgentSummary } from "../domain/agents.js";
import type { DirectoryAgent } from "../domain/reads.js";

export interface AgentCatalogQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
  q?: string | undefined;
  theme?: string | undefined;
  available?: boolean | undefined;
  adviceForSale?: boolean | undefined;
  tokensOnly?: boolean | undefined;
}
export interface CatalogPage<T> {
  items: T[];
  nextCursor: string | null;
}
/** Bounded public discovery. Filtering and deterministic ordering precede the page boundary. */
export interface AgentCatalog {
  pageAgents(query: AgentCatalogQuery): Promise<CatalogPage<AgentSummary>>;
  pageDirectory(query: AgentCatalogQuery): Promise<CatalogPage<DirectoryAgent>>;
}
