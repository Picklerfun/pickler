import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, type AuthState, type Decision } from "../src/middleware";
import { authConfigured, hasSessionCookie, returnTo } from "../src/server/guard";

const HOSTS = { marketplace: "pickler.fun", studio: "app.pickler.fun" };

// Authentication is an argument to `decide` rather than a read inside it, for the same reason
// `previewAllowed(nodeEnv, authConfigured)` takes both of its conditions: a gate exercised only
// through the environment the test happens to run in is a gate tested in one position.

/** Configured, and the request carries a session. */
const IN: AuthState = { configured: true, session: true };
/** Configured, and it does not. */
const OUT: AuthState = { configured: true, session: false };
/** Not configured: nobody can sign in, so there is nothing to guard. */
const OFF: AuthState = { configured: false, session: false };

const PROTECTED = ["/console", "/account", "/custody"];
const PUBLIC = ["/signin", "/signup", "/auth/callback", "/apply"];

/**
 * Where a sign-in redirect points, with the errand stripped off.
 *
 * Two rules live in that one string — that the guard fired, and what it carried — and asserting the
 * whole of it everywhere would mean every guard test reddens for either. `sentTo` owns the first
 * and `nextOf` owns the second, so a mutation tells you which one broke.
 */
function sentTo(decision: Decision): string {
  assert.ok(decision.kind === "signIn", `expected a sign-in redirect, got ${decision.kind}`);
  return decision.to.split("?")[0]!;
}

/** The `next` a sign-in redirect carries, read back the way the sign-in page reads it. */
function nextOf(decision: Decision): string | null {
  assert.ok(decision.kind === "signIn", `expected a sign-in redirect, got ${decision.kind}`);
  return returnTo(new URLSearchParams(decision.to.split("?")[1]).get("next"));
}

test("a path on its own host is served", () => {
  assert.deepEqual(decide("pickler.fun", "/leaderboard", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/account", HOSTS, OFF), { kind: "serve" });
});

test("the studio root serves the studio", () => {
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, OFF), { kind: "rewrite", to: "/console" });
});

test("a studio path asked of the marketplace redirects, so old links survive", () => {
  assert.deepEqual(decide("pickler.fun", "/account", HOSTS, OFF), {
    kind: "redirect",
    to: "https://app.pickler.fun/account",
  });
});

test("a marketplace path asked of the studio is 404, not a redirect", () => {
  // A redirect would give every screen two canonical URLs.
  assert.deepEqual(decide("app.pickler.fun", "/leaderboard", HOSTS, OFF), { kind: "notFound" });
});

test("shared paths are served on both hosts", () => {
  assert.deepEqual(decide("app.pickler.fun", "/api/v1/landing", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("pickler.fun", "/brand/logo.png", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/brand/logo.png", HOSTS, OFF), { kind: "serve" });
});

test("development is inert: every path is served on localhost", () => {
  assert.deepEqual(decide("localhost:3001", "/console", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/leaderboard", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/", HOSTS, OFF), { kind: "serve" });
});

// --- One studio, one URL --------------------------------------------------------------------

test("the studio lives at the root, so /console there is a second URL and redirects to it", () => {
  // The same canonical-URL rule the 404 above applies in the other direction. It is a redirect and
  // not a 404 because /console is linked from the nav, from the account and from old bookmarks.
  assert.deepEqual(decide("app.pickler.fun", "/console", HOSTS, OFF), {
    kind: "redirect",
    to: "/",
  });
});

test("/console on the marketplace still crosses to the studio host, keeping the path", () => {
  // The cross-host hop does not also canonicalise: the studio host is where that rule is applied,
  // and collapsing both here would hide whether the studio host applies it at all.
  assert.deepEqual(decide("pickler.fun", "/console", HOSTS, OFF), {
    kind: "redirect",
    to: "https://app.pickler.fun/console",
  });
});

// --- The guard ------------------------------------------------------------------------------

test("a protected path without a session goes to sign-in", () => {
  assert.equal(sentTo(decide("app.pickler.fun", "/account", HOSTS, OUT)), "/signin");
  assert.equal(sentTo(decide("app.pickler.fun", "/custody", HOSTS, OUT)), "/signin");
});

test("sign-in carries where they were going, so they land there and not on the studio home", () => {
  // The round trip, not the spelling: what the guard writes is what the sign-in page reads back.
  assert.equal(nextOf(decide("app.pickler.fun", "/account", HOSTS, OUT)), "/account");
  assert.equal(nextOf(decide("app.pickler.fun", "/custody", HOSTS, OUT)), "/custody");
  assert.equal(nextOf(decide("localhost:3001", "/console", HOSTS, OUT)), "/console");
  // The studio root is the console, so coming back to `/` is coming back to the console.
  assert.equal(nextOf(decide("app.pickler.fun", "/", HOSTS, OUT)), "/");
});

test("the studio root is protected too, because it IS the console", () => {
  // Guarding the literal pathname would leave app.pickler.fun/ open — the studio's front door.
  assert.equal(sentTo(decide("app.pickler.fun", "/", HOSTS, OUT)), "/signin");
});

test("a protected path with a session is served", () => {
  assert.deepEqual(decide("app.pickler.fun", "/account", HOSTS, IN), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/custody", HOSTS, IN), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, IN), { kind: "rewrite", to: "/console" });
});

test("the paths sign-in needs stay open without one", () => {
  // You cannot sign in if signing in requires a session, and /apply is for someone with no account.
  for (const path of PUBLIC) {
    assert.deepEqual(decide("app.pickler.fun", path, HOSTS, OUT), { kind: "serve" }, path);
  }
});

test("the marketplace is not behind the guard", () => {
  assert.deepEqual(decide("pickler.fun", "/leaderboard", HOSTS, OUT), { kind: "serve" });
  assert.deepEqual(decide("pickler.fun", "/", HOSTS, OUT), { kind: "serve" });
});

test("the guard is inert when authentication is not configured", () => {
  // Nobody can sign in, so guarding means nothing — and the preview fixtures behind
  // `previewAllowed(nodeEnv, authConfigured)` are the only way /console and /account can be seen at
  // all. A guard that fired here would take every design check over those routes down with it.
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, OFF), { kind: "rewrite", to: "/console" });
  assert.deepEqual(decide("app.pickler.fun", "/account", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/custody", HOSTS, OFF), { kind: "serve" });
  for (const path of PROTECTED) {
    assert.deepEqual(decide("localhost:3001", path, HOSTS, OFF), { kind: "serve" }, path);
  }
});

test("the guard is a property of the path, not of the host", () => {
  // Configured on localhost is a real configuration, and the protected paths are protected there.
  assert.equal(sentTo(decide("localhost:3001", "/console", HOSTS, OUT)), "/signin");
  assert.deepEqual(decide("localhost:3001", "/console", HOSTS, IN), { kind: "serve" });
});

test("a path that merely starts with a protected name is not protected", () => {
  // /accounts-of-agents is a marketplace page and must not be bounced to sign-in.
  assert.deepEqual(decide("pickler.fun", "/accounts-of-agents", HOSTS, OUT), { kind: "serve" });
});

test("a path the host does not own is settled before the guard", () => {
  // Guarding first would answer /account on the marketplace with a sign-in page served from the
  // wrong host, and would bounce a studio-host 404 to sign-in instead of refusing it.
  assert.deepEqual(decide("pickler.fun", "/account", HOSTS, OUT), {
    kind: "redirect",
    to: "https://app.pickler.fun/account",
  });
  assert.deepEqual(decide("app.pickler.fun", "/leaderboard", HOSTS, OUT), { kind: "notFound" });
});

test("what both hosts share stays shared: the API does its own bearer check", () => {
  assert.deepEqual(decide("app.pickler.fun", "/api/v1/landing", HOSTS, OUT), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/brand/logo.png", HOSTS, OUT), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/_next/static/c.js", HOSTS, OUT), { kind: "serve" });
});

test("authentication is configured only when both halves of the pair are set", () => {
  // Either one alone is a half-configured project nobody can sign in to, and a guard that fired on
  // it would shut the studio with no way through. Both positions, because one is not a gate.
  assert.equal(authConfigured("https://abcdefgh.supabase.co", "sb_publishable_x"), true);
  assert.equal(authConfigured("https://abcdefgh.supabase.co", undefined), false);
  assert.equal(authConfigured("https://abcdefgh.supabase.co", ""), false);
  assert.equal(authConfigured(undefined, "sb_publishable_x"), false);
  assert.equal(authConfigured("", "sb_publishable_x"), false);
  assert.equal(authConfigured(undefined, undefined), false);
});

// --- Reading the session off the request ----------------------------------------------------

const PROJECT = "https://abcdefgh.supabase.co";

test("the session cookie is the one @supabase/ssr writes for this project", () => {
  assert.equal(hasSessionCookie(["sb-abcdefgh-auth-token"], PROJECT), true);
});

test("a chunked session cookie is a session", () => {
  // @supabase/ssr splits a long token into `<key>.0`, `<key>.1`; neither half is named `<key>`.
  const chunks = ["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1"];
  assert.equal(hasSessionCookie(chunks, PROJECT), true);
});

test("the code verifier is not a session", () => {
  // It is written when a sign-in STARTS. Counting it would open the guard for someone who has only
  // ever asked for a code — the exact person it exists to stop.
  assert.equal(hasSessionCookie(["sb-abcdefgh-auth-token-code-verifier"], PROJECT), false);
  assert.equal(hasSessionCookie(["sb-abcdefgh-auth-token-flows-code-verifier"], PROJECT), false);
});

test("another project's cookie is not this project's session", () => {
  assert.equal(hasSessionCookie(["sb-someoneelse-auth-token"], PROJECT), false);
});

test("no cookies, no session", () => {
  assert.equal(hasSessionCookie([], PROJECT), false);
  assert.equal(hasSessionCookie(["pk_apply", "theme"], PROJECT), false);
});

test("an unset or unreadable Supabase URL yields no session", () => {
  // The same URL that makes `configured` false. It is `configured` that keeps the guard inert
  // there, not this: on its own, an unreadable URL would shut every protected path.
  assert.equal(hasSessionCookie(["sb-abcdefgh-auth-token"], ""), false);
  assert.equal(hasSessionCookie(["sb-abcdefgh-auth-token"], "not a url"), false);
});

// --- Coming back afterwards -----------------------------------------------------------------

test("a path on this site is where they came from", () => {
  assert.equal(returnTo("/account"), "/account");
  assert.equal(returnTo("/console?section=picks"), "/console?section=picks");
  assert.equal(returnTo("/"), "/");
});

test("somewhere else is not, so `next` cannot be an open redirect", () => {
  // `//evil.example` is protocol-relative and `/\evil.example` is what a browser normalises into
  // one; both leave this site while looking like a path.
  assert.equal(returnTo("//evil.example"), null);
  assert.equal(returnTo("/\\evil.example"), null);
  assert.equal(returnTo("https://evil.example/"), null);
  assert.equal(returnTo("javascript:alert(1)"), null);
  assert.equal(returnTo("account"), null);
});

test("no `next` at all is no destination, not a broken one", () => {
  assert.equal(returnTo(null), null);
  assert.equal(returnTo(undefined), null);
  assert.equal(returnTo(""), null);
});
