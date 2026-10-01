import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_CALLBACK, decide, type AuthState, type Decision } from "../src/middleware";
import { AUTH_CALLBACK_PATH } from "../src/features/auth/lib/account";
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

const PROTECTED = ["/studio", "/account", "/passkey"];
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
  assert.deepEqual(decide("app.pickler.fun", "/passkey", HOSTS, OFF), { kind: "serve" });
});

test("the studio root serves the studio", () => {
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, OFF), { kind: "rewrite", to: "/studio" });
});

test("each host 404s what it does not own, in both directions", () => {
  // Symmetric on purpose. Nothing has ever been deployed, so there is no link or bookmark anywhere
  // that a cross-host redirect would rescue, and a redirect kept for nobody is a branch, a test and
  // a behaviour to keep true forever. Links inside this repository that cross products go through
  // `studioHref`, which builds an absolute URL rather than leaning on a rewrite.
  assert.deepEqual(decide("pickler.fun", "/account", HOSTS, OFF), { kind: "notFound" });
  assert.deepEqual(decide("pickler.fun", "/studio", HOSTS, OFF), { kind: "notFound" });
  assert.deepEqual(decide("pickler.fun", "/passkey", HOSTS, OFF), { kind: "notFound" });
  assert.deepEqual(decide("app.pickler.fun", "/leaderboard", HOSTS, OFF), { kind: "notFound" });
  assert.deepEqual(decide("app.pickler.fun", "/portfolio", HOSTS, OFF), { kind: "notFound" });
});

test("no decision is a redirect any more, on either host", () => {
  // The only redirect left in this function is the sign-in guard, which is not about an address.
  for (const host of ["pickler.fun", "app.pickler.fun"]) {
    for (const path of ["/", "/studio", "/account", "/passkey", "/leaderboard", "/apply"]) {
      const kind = decide(host, path, HOSTS, OFF).kind;
      assert.ok(["serve", "notFound", "rewrite"].includes(kind), `${host}${path} gave ${kind}`);
    }
  }
});

test("shared paths are served on both hosts", () => {
  assert.deepEqual(decide("app.pickler.fun", "/api/v1/landing", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("pickler.fun", "/brand/logo.png", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/brand/logo.png", HOSTS, OFF), { kind: "serve" });
});

test("development is inert: every path is served on localhost", () => {
  assert.deepEqual(decide("localhost:3001", "/studio", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/leaderboard", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("localhost:3001", "/", HOSTS, OFF), { kind: "serve" });
});

// --- One studio, one URL --------------------------------------------------------------------

test("the studio lives at the root, so /studio there is a second URL and is refused", () => {
  // Not a redirect. Nothing has ever linked to it from outside this repository, and the links
  // inside it resolve through `studioHref` instead.
  assert.deepEqual(decide("app.pickler.fun", "/studio", HOSTS, OFF), { kind: "notFound" });
});

test("refusing /studio does not refuse the studio itself", () => {
  // The rewrite is internal and Next does not re-run middleware on it, so the page `/` renders is
  // the one `/studio` names. Getting this wrong 404s the studio's homepage for every visitor.
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, OFF), { kind: "rewrite", to: "/studio" });
});

test("/studio is still the studio where both products share a host", () => {
  // On localhost and previews `/` is the marketplace, so the studio has to keep its own route.
  assert.deepEqual(decide("localhost:3001", "/studio", HOSTS, OFF), { kind: "serve" });
});

// --- The guard ------------------------------------------------------------------------------

test("a protected path without a session goes to sign-in", () => {
  assert.equal(sentTo(decide("app.pickler.fun", "/account", HOSTS, OUT)), "/signin");
  assert.equal(sentTo(decide("app.pickler.fun", "/passkey", HOSTS, OUT)), "/signin");
});

test("sign-in carries where they were going, so they land there and not on the studio home", () => {
  // The round trip, not the spelling: what the guard writes is what the sign-in page reads back.
  assert.equal(nextOf(decide("app.pickler.fun", "/account", HOSTS, OUT)), "/account");
  assert.equal(nextOf(decide("app.pickler.fun", "/passkey", HOSTS, OUT)), "/passkey");
  assert.equal(nextOf(decide("localhost:3001", "/studio", HOSTS, OUT)), "/studio");
  // The studio root is the studio page, so coming back to `/` is coming back to the studio.
  assert.equal(nextOf(decide("app.pickler.fun", "/", HOSTS, OUT)), "/");
});

test("the studio root is protected too, because it IS the studio page", () => {
  // Guarding the literal pathname would leave app.pickler.fun/ open — the studio's front door.
  assert.equal(sentTo(decide("app.pickler.fun", "/", HOSTS, OUT)), "/signin");
});

test("a protected path with a session is served", () => {
  assert.deepEqual(decide("app.pickler.fun", "/account", HOSTS, IN), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/passkey", HOSTS, IN), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, IN), { kind: "rewrite", to: "/studio" });
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
  // `previewAllowed(nodeEnv, authConfigured)` are the only way /studio and /account can be seen at
  // all. A guard that fired here would take every design check over those routes down with it.
  assert.deepEqual(decide("app.pickler.fun", "/", HOSTS, OFF), { kind: "rewrite", to: "/studio" });
  assert.deepEqual(decide("app.pickler.fun", "/account", HOSTS, OFF), { kind: "serve" });
  assert.deepEqual(decide("app.pickler.fun", "/passkey", HOSTS, OFF), { kind: "serve" });
  for (const path of PROTECTED) {
    assert.deepEqual(decide("localhost:3001", path, HOSTS, OFF), { kind: "serve" }, path);
  }
});

test("the guard is a property of the path, not of the host", () => {
  // Configured on localhost is a real configuration, and the protected paths are protected there.
  assert.equal(sentTo(decide("localhost:3001", "/studio", HOSTS, OUT)), "/signin");
  assert.deepEqual(decide("localhost:3001", "/studio", HOSTS, IN), { kind: "serve" });
});

test("a path that merely starts with a protected name is not protected", () => {
  // /accounts-of-agents is a marketplace page and must not be bounced to sign-in.
  assert.deepEqual(decide("pickler.fun", "/accounts-of-agents", HOSTS, OUT), { kind: "serve" });
});

test("a path the host does not own is settled before the guard", () => {
  // Guarding first would answer /account on the marketplace with a sign-in page served from the
  // wrong host, and would bounce a studio-host 404 to sign-in instead of refusing it.
  assert.deepEqual(decide("pickler.fun", "/account", HOSTS, OUT), { kind: "notFound" });
  assert.deepEqual(decide("pickler.fun", "/passkey", HOSTS, OUT), { kind: "notFound" });
  assert.deepEqual(decide("app.pickler.fun", "/leaderboard", HOSTS, OUT), { kind: "notFound" });
  assert.deepEqual(decide("app.pickler.fun", "/studio", HOSTS, OUT), { kind: "notFound" });
});

test("the old custody address is gone from the studio, with nothing left behind", () => {
  // It was created hours ago, never deployed and never linked, so it needed no redirect. A
  // marketplace path by default, which the studio host refuses like any other.
  assert.deepEqual(decide("app.pickler.fun", "/custody", HOSTS, OFF), { kind: "notFound" });
  assert.deepEqual(decide("app.pickler.fun", "/custody", HOSTS, OUT), { kind: "notFound" });
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
  assert.equal(returnTo("/studio?section=picks"), "/studio?section=picks");
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

test("a control character anywhere is refused, because a browser strips it before resolving", () => {
  // Tab, CR and LF are removed by the URL parser, so `/\t/evil.example` is `//evil.example` by the
  // time anything navigates to it. Checking the second character alone never sees that.
  for (const asked of [
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\t\\evil.example",
    "/\t\t/evil.example",
    "\t//evil.example",
    "/account\n",
    "/account\u0000",
    "/account\u007f",
  ]) {
    assert.equal(returnTo(asked), null, JSON.stringify(asked));
  }
});

test("a backslash anywhere is refused, not only in second place", () => {
  assert.equal(returnTo("/account\\..\\evil"), null);
  assert.equal(returnTo("/a/\\evil.example"), null);
});

test("what the query string decodes to is what gets checked", () => {
  // `next` is read through URLSearchParams, which decodes it: the encoded forms arrive here as the
  // characters themselves.
  const decoded = (query: string) => new URLSearchParams(query).get("next");
  for (const query of [
    "next=%2F%09%2Fevil.example",
    "next=%2F%0A%2Fevil.example",
    "next=%2F%0D%2Fevil.example",
    "next=%2F%09%5Cevil.example",
    "next=%2F%2Fevil.example",
    "next=%2F%5Cevil.example",
  ]) {
    assert.equal(returnTo(decoded(query)), null, query);
  }
  assert.equal(returnTo(decoded("next=%2Faccount%3Ftab%3Dkeys")), "/account?tab=keys");
});

test("an ordinary path keeps its query and its fragment", () => {
  assert.equal(returnTo("/?agent=x&section=trading"), "/?agent=x&section=trading");
  assert.equal(returnTo("/account?next=%2F%2Fevil.example"), "/account?next=%2F%2Fevil.example");
  assert.equal(returnTo("/studio/create?from=home#brief"), "/studio/create?from=home#brief");
  assert.equal(returnTo("/agents/half-time"), "/agents/half-time");
});

test("a path that resolves to a double slash or climbs is refused", () => {
  // `/.//evil.example` and `/x/..//evil.example` parse to the pathname `//evil.example` on our own
  // origin. Staying here then rests on how the server normalises slashes, which is not ours to say.
  for (const asked of [
    "/.//evil.example",
    "/x/..//evil.example",
    "/x//evil.example",
    "/account//",
    "/./account",
    "/account/../studio",
    "/account/..",
    "/account/.",
    "/%2e%2e/account",
    "/account/%2E/keys",
    "/x/%2e%2e//evil.example",
  ]) {
    assert.equal(returnTo(asked), null, JSON.stringify(asked));
  }
});

test("dots and slashes that are not segments of their own are ordinary", () => {
  assert.equal(returnTo("/agents/half.time"), "/agents/half.time");
  assert.equal(returnTo("/.well-known/x"), "/.well-known/x");
  assert.equal(returnTo("/account?next=//x/../y"), "/account?next=//x/../y");
  assert.equal(returnTo("/account#a//b"), "/account#a//b");
});

test("no `next` at all is no destination, not a broken one", () => {
  assert.equal(returnTo(null), null);
  assert.equal(returnTo(undefined), null);
  assert.equal(returnTo(""), null);
});

test("the auth callback on the marketplace is sent, as it is, to the studio", () => {
  assert.deepEqual(decide("pickler.fun", "/auth/callback", HOSTS, OUT), {
    kind: "toStudio",
    to: "https://app.pickler.fun/auth/callback",
  });
});

test("the auth callback on the studio is served there, where its cookie belongs", () => {
  assert.deepEqual(decide("app.pickler.fun", "/auth/callback", HOSTS, OUT), { kind: "serve" });
});

test("the auth callback on a shared host is served where it is", () => {
  assert.deepEqual(decide("localhost:3001", "/auth/callback", HOSTS, OUT), { kind: "serve" });
});

test("only the callback crosses: another studio path on the marketplace is still refused", () => {
  assert.deepEqual(decide("pickler.fun", "/auth/other", HOSTS, OUT), { kind: "notFound" });
});

test("the middleware's callback path is the one sign-in asks Supabase to return to", () => {
  assert.equal(AUTH_CALLBACK, AUTH_CALLBACK_PATH);
});
