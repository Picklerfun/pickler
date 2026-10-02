import { z } from "zod";
import type { XPost } from "@pickler/core";

const X_API = "https://api.x.com/2";
const TIMEOUT_MS = 5_000;

/** X cannot answer right now: no token configured, rate limited, down, or an unreadable reply. */
export class XUnavailableError extends Error {
  constructor(message = "X is unavailable") {
    super(message);
    this.name = "XUnavailableError";
  }
}

export interface XUser {
  id: string;
  /** The handle with X's own casing, without "@". */
  handle: string;
}

export interface XClient {
  /** False when no bearer token is configured; Connect X then says it is not open yet. */
  readonly available: boolean;
  /** The account behind a handle, or null when X has no such account. */
  userByHandle(handle: string): Promise<XUser | null>;
  /** Up to 20 of the user's posts made at or after `since`. */
  recentPosts(userId: string, since: Date): Promise<XPost[]>;
}

const userReply = z.object({
  data: z.object({ id: z.string(), username: z.string() }).optional(),
});

const postsReply = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        author_id: z.string(),
        text: z.string(),
        created_at: z.string().datetime(),
      }),
    )
    .optional(),
});

export function createXClient(options: {
  bearerToken: string | undefined;
  fetch?: typeof fetch;
}): XClient {
  const { bearerToken } = options;
  const fetcher = options.fetch ?? fetch;

  // Failures carry no X body: it can echo request details and is of no use to the owner.
  async function get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    if (!bearerToken) {
      throw new XUnavailableError("X is not configured");
    }
    let response: Response;
    try {
      response = await fetcher(`${X_API}${path}`, {
        headers: { authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "manual",
      });
    } catch {
      throw new XUnavailableError("X could not be reached");
    }
    if (!response.ok) {
      throw new XUnavailableError(`X answered ${response.status}`);
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new XUnavailableError("X sent an unreadable answer");
    }
    return parsed.data;
  }

  return {
    available: Boolean(bearerToken),
    async userByHandle(handle) {
      const reply = await get(`/users/by/username/${encodeURIComponent(handle)}`, userReply);
      return reply.data ? { id: reply.data.id, handle: reply.data.username } : null;
    },
    async recentPosts(userId, since) {
      const query = new URLSearchParams({
        max_results: "20",
        start_time: since.toISOString(),
        "tweet.fields": "created_at,author_id",
      });
      const reply = await get(`/users/${encodeURIComponent(userId)}/tweets?${query}`, postsReply);
      return (reply.data ?? []).map((post) => ({
        id: post.id,
        authorId: post.author_id,
        text: post.text,
        createdAt: new Date(post.created_at),
      }));
    },
  };
}
