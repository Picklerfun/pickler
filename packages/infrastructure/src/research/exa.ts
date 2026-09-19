import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PilotError,
  publicSourceUrl,
  type WebSearch,
  type PageReader,
  type Source,
  type SearchResult,
} from "@pickler/core";
import { providerJson } from "./http.js";

const itemSchema = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  text: z.string().min(1),
  publishedDate: z.string().nullish(),
});
const responseSchema = z.object({
  results: z.array(itemSchema).max(10),
  costDollars: z.unknown().optional(),
});
const MAX_CONTENT = 6000;
export class ExaResearch implements WebSearch, PageReader {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async call(path: string, body: unknown, signal: AbortSignal): Promise<SearchResult> {
    if (!this.apiKey) {
      throw new PilotError("PLUGIN_NOT_CONFIGURED", "Exa credentials are required when enabled");
    }
    const parsed = responseSchema.safeParse(
      await providerJson(
        `https://api.exa.ai/${path}`,
        {
          method: "POST",
          headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        signal,
        this.fetcher,
      ),
    );
    if (!parsed.success) {
      throw new PilotError("INVALID_PROVIDER_RESPONSE", "Exa returned incomplete evidence");
    }
    const sources = parsed.data.results.map((item, index) => {
      const url = publicSourceUrl(item.url);
      if (!url) {
        throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid source URL");
      }
      const date = item.publishedDate;
      if (date && !Number.isFinite(Date.parse(date))) {
        throw new PilotError("INVALID_PROVIDER_RESPONSE", "Invalid source date");
      }
      return {
        id: createHash("sha256").update(item.url).digest("hex").slice(0, 24),
        url: item.url,
        title: (item.title ?? "").slice(0, 500),
        content: item.text.slice(0, MAX_CONTENT),
        truncated: item.text.length >= MAX_CONTENT,
        retrievedAt: new Date().toISOString(),
        publishedAt: date ? new Date(date).toISOString() : null,
        provider: "exa",
        ...(index === 0 && parsed.data.costDollars !== undefined
          ? { providerUsage: parsed.data.costDollars }
          : {}),
      };
    });
    return { sources, usage: parsed.data.costDollars ?? null };
  }
  search(query: string, signal: AbortSignal): Promise<SearchResult> {
    if (!query.trim() || query.length > 1000) {
      throw new PilotError("INVALID_INPUT", "Invalid search query");
    }
    return this.call("search", { query, numResults: 5, contents: { text: true } }, signal);
  }

  async read(url: string, signal: AbortSignal): Promise<Source> {
    if (!publicSourceUrl(url)) {
      throw new PilotError("INVALID_INPUT", "Invalid page URL");
    }
    const result = await this.call("contents", { urls: [url], text: true }, signal);
    const source = result.sources.find((s) => publicSourceUrl(s.url) === publicSourceUrl(url));
    if (!source) {
      throw new PilotError("INVALID_PROVIDER_RESPONSE", "Exa did not return the requested page");
    }
    return source;
  }
}
