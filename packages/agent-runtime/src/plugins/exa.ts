import {
  PilotError,
  type PageReader,
  type ResearchTools,
  type SearchResult,
  type Source,
  type WebMode,
  type WebSearch,
} from "@pickler/core";
import { exaSearchRequest } from "@pickler/infrastructure";

/** Where an agent may read on the web. `null` elsewhere in this module means the web is off. */
export interface WebSites {
  mode: WebMode;
  sites: string[];
}

/** The Exa adapter surface this module needs: a search that can be limited to domains. */
export interface DomainSearch extends PageReader {
  search(
    query: string,
    signal: AbortSignal,
    includeDomains?: readonly string[],
  ): Promise<SearchResult>;
}

export const ANYWHERE: WebSites = { mode: "anywhere", sites: [] };

function bareHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

/** Only-mode keeps to the list: a listed site or one of its subdomains. Other modes allow any host. */
export function allowedHost(url: string, web: WebSites): boolean {
  if (web.mode !== "only") {
    return true;
  }

  let host: string;
  try {
    host = bareHost(new URL(url).hostname);
  } catch {
    return false;
  }

  return web.sites.some((site) => {
    const listed = bareHost(site);
    return host === listed || host.endsWith(`.${listed}`);
  });
}

function includeDomains(web: WebSites): string[] | undefined {
  if (web.mode === "anywhere") {
    return undefined;
  }
  return web.sites;
}

/** The body Exa receives for a search. Anywhere is byte-identical to the request before site lists. */
export function exaSearchBody(query: string, web: WebSites) {
  return exaSearchRequest(query, includeDomains(web));
}

function refuseOutside(url: string, web: WebSites | null): void {
  if (!web) {
    throw new PilotError("INVALID_INPUT", "The web is off for this agent");
  }
  if (!allowedHost(url, web)) {
    throw new PilotError("INVALID_INPUT", "Outside the agent's site list");
  }
}

/**
 * The run's web search and page reader, keeping the promise the studio shows:
 * only never leaves the list, prefer starts with it and goes wider once when it finds nothing,
 * anywhere searches the whole web, and a web that is off reads nothing.
 */
export function siteScopedWeb(
  exa: DomainSearch,
  web: WebSites | null,
  onFallback: (data: { query: string; sites: string[]; restrictedUsage: unknown }) => Promise<void>,
): WebSearch & PageReader {
  return {
    async search(query, signal) {
      if (!web) {
        return { sources: [], usage: null };
      }

      const restricted = await exa.search(query, signal, includeDomains(web));

      if (web.mode === "only") {
        return {
          ...restricted,
          sources: restricted.sources.filter((source) => allowedHost(source.url, web)),
        };
      }
      if (web.mode === "anywhere" || restricted.sources.length > 0) {
        return restricted;
      }

      await onFallback({ query, sites: web.sites, restrictedUsage: restricted.usage });
      return exa.search(query, signal);
    },
    async read(url, signal): Promise<Source> {
      refuseOutside(url, web);
      return exa.read(url, signal);
    },
  };
}

/**
 * The tools the model calls. Refusing an off-list page here, before the runner's provider call,
 * keeps a refused read an answer to the model rather than a provider failure that ends the run.
 * With the web off the page reader is withheld; search stays because the runner requires
 * supporting and contradicting searches, and it returns nothing.
 */
export function siteScopedTools(
  tools: Partial<ResearchTools>,
  web: WebSites | null,
): Partial<ResearchTools> {
  if (web && web.mode !== "only") {
    return tools;
  }

  const { readPage, ...rest } = tools;
  if (!web || !readPage) {
    return rest;
  }

  return {
    ...rest,
    readPage: async (url) => {
      refuseOutside(url, web);
      return readPage(url);
    },
  };
}
