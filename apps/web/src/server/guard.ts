// What stands between an anonymous request and the studio.
//
// The API already refuses anonymous callers — every route behind it wants a bearer JWT — so no
// *data* leaks without a session. What leaks without this file is the screens and the client
// bundle: `/studio` renders `<Studio>` unconditionally, `Studio` is a client component, and so
// the whole studio ships to anyone who asks for the URL before the browser thinks to look for a
// session. This moves that check in front of the response.
//
// It reads the session as a cookie *name*, not a verified token. That is the right depth here: the
// guard decides which screens to hand out, and the API decides which data to hand out, on a JWT it
// verifies. A forged cookie buys an empty studio that cannot load a single row.

import { firstSegment } from "./hosts";

/**
 * The screens that are nobody's but yours. Everything else the studio owns — `/signin`, `/signup`,
 * `/auth/callback` — has to stay open: you cannot sign in if signing in needs a session. The
 * creator application is the marketplace's (`/create`) and never comes near this.
 *
 * `studio` is here as the segment the studio root resolves to, not as a URL anyone can reach: on
 * the studio host `/studio` is a 404 and `/` is the studio. On localhost, where both products are
 * served together, it is the studio's real address and is guarded as one.
 *
 * These are a subset of `STUDIO_SEGMENTS` in ./hosts.ts, and the matching is the same whole-segment
 * equality, so `/accounts-of-agents` is not `/account`.
 */
const PROTECTED_SEGMENTS = new Set(["studio", "account", "passkey"]);

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

/** C0 controls and DEL. A URL parser strips tab, CR and LF; none of the rest belongs in a path. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A `.` or `..` segment, with either dot percent-encoded. */
const DOTS = /^(?:\.|%2e){1,2}$/i;

/** An origin nothing is served from, so a destination that keeps it went nowhere. */
const PROBE_ORIGIN = "https://pickler.invalid";

/**
 * The `next` from a sign-in URL, or null if it is not somewhere on this site.
 *
 * `next` arrives from the address bar, so it is a destination anyone can write. Only a path is
 * accepted: `//evil.example` is protocol-relative and `/\evil.example` is what a browser normalises
 * into one, and both would look like a path and leave the site. The result is used as an `href` and
 * a `router.push`, so an absolute URL of any scheme is refused rather than trusted.
 *
 * Two checks, because looking at the first two characters is a guess about what a browser will do
 * with the rest. A browser strips tab, CR and LF before it resolves anything, so `/\t/evil.example`
 * IS `//evil.example`; a control character or a backslash anywhere is refused outright. Then the
 * parser a browser would use is asked directly: resolved against an origin of our own, the
 * destination has to still be on it, and its path must not open with or contain `//` — which is
 * one slash-normalisation away from protocol-relative. A `.` or `..` segment is how a path gets
 * there while looking ordinary, and no link this site writes has one, so those are refused too.
 */
export function returnTo(asked: string | null | undefined): string | null {
  if (!asked || asked[0] !== "/" || asked[1] === "/") {
    return null;
  }
  if (CONTROL.test(asked) || asked.includes("\\")) {
    return null;
  }
  // `.` and `..`, spelled either way: the parser folds them away, so they are read off what was
  // asked. `/x/..//evil.example` is the case — it parses to `//evil.example` on this origin.
  const path = asked.split(/[?#]/)[0]!;
  if (path.split("/").some((segment) => DOTS.test(segment))) {
    return null;
  }
  try {
    const parsed = new URL(asked, PROBE_ORIGIN);
    if (parsed.origin !== PROBE_ORIGIN || parsed.pathname.includes("//")) {
      return null;
    }
  } catch {
    return null;
  }
  return asked;
}
