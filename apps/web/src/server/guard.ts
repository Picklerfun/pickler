// What stands between an anonymous request and the studio.
//
// The API already refuses anonymous callers — every route behind it wants a bearer JWT — so no
// *data* leaks without a session. What leaks without this file is the screens and the client
// bundle: `/console` renders `<Console>` unconditionally, `Console` is a client component, and so
// the whole studio ships to anyone who asks for the URL before the browser thinks to look for a
// session. This moves that check in front of the response.
//
// It reads the session as a cookie *name*, not a verified token. That is the right depth here: the
// guard decides which screens to hand out, and the API decides which data to hand out, on a JWT it
// verifies. A forged cookie buys an empty studio that cannot load a single row.

import { firstSegment } from "./hosts";

/**
 * The screens that are nobody's but yours. Everything else the studio owns — `/signin`, `/signup`,
 * `/auth/callback`, `/apply` — has to stay open: you cannot sign in if signing in needs a session,
 * and applying for studio access is done by someone who has no account yet.
 *
 * `console` is here as the segment the studio root resolves to, not as a URL anyone can reach: on
 * the studio host `/console` is a 404 and `/` is the studio. On localhost, where both products are
 * served together, it is the studio's real address and is guarded as one.
 *
 * These are a subset of `STUDIO_SEGMENTS` in ./hosts.ts, and the matching is the same whole-segment
 * equality, so `/accounts-of-agents` is not `/account`.
 */
const PROTECTED_SEGMENTS = new Set(["console", "account", "passkey"]);

export function requiresSession(pathname: string): boolean {
  return PROTECTED_SEGMENTS.has(firstSegment(pathname));
}

/**
 * Whether authentication is configured at all — the same pair `isAuthConfigured()` reads.
 *
 * Both halves are arguments rather than reads for the reason `previewAllowed(nodeEnv,
 * authConfigured)` takes both of its own: the guard turns on nothing but this, and a condition
 * exercised only through the environment the test happens to run in is a condition tested once.
 *
 * When it is false nobody can sign in, so there is nothing to guard and the guard stays inert —
 * which is also what leaves the preview fixtures every design check walks reachable.
 */
export function authConfigured(url: string | undefined, key: string | undefined): boolean {
  return Boolean(url && key);
}

/**
 * The cookie `@supabase/ssr` writes for this project: `sb-<ref>-auth-token`, where the ref is the
 * first label of the Supabase URL's hostname. Derived rather than matched loosely, because an
 * `sb-*-auth-token` from another project is not a session here.
 *
 * Null when there is no readable URL, which is also when `isAuthConfigured()` is false. The guard
 * is held inert by that flag, never by this: on its own, an unreadable URL would shut every
 * protected path rather than open it.
 */
function sessionCookieName(supabaseUrl: string): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

/** `<key>.0`, `<key>.1`, … — how @supabase/ssr splits a token too long for one cookie. */
const CHUNK = /^\.(0|[1-9][0-9]*)$/;

/**
 * Whether these cookie names carry a session for this project.
 *
 * Whole-name equality or a numbered chunk, never a prefix. `sb-<ref>-auth-token-code-verifier` is
 * written when a sign-in *starts* and is gone by the time one finishes; counting it would open the
 * guard for someone who has only ever asked for a code, which is the exact person it stops.
 */
export function hasSessionCookie(names: readonly string[], supabaseUrl: string): boolean {
  const key = sessionCookieName(supabaseUrl);
  if (!key) {
    return false;
  }
  return names.some(
    (name) => name === key || (name.startsWith(key) && CHUNK.test(name.slice(key.length))),
  );
}

/** Where the guard sends someone, carrying where they were going. */
export function signInPath(pathname: string): string {
  return `/signin?next=${encodeURIComponent(pathname)}`;
}

/**
 * The `next` from a sign-in URL, or null if it is not somewhere on this site.
 *
 * `next` arrives from the address bar, so it is a destination anyone can write. Only a path is
 * accepted: `//evil.example` is protocol-relative and `/\evil.example` is what a browser normalises
 * into one, and both would look like a path and leave the site. The result is used as an `href` and
 * a `router.push`, so an absolute URL of any scheme is refused rather than trusted.
 */
export function returnTo(asked: string | null | undefined): string | null {
  if (!asked || asked[0] !== "/" || asked[1] === "/" || asked[1] === "\\") {
    return null;
  }
  return asked;
}
