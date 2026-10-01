// `decide` is pure and tested in every position in middleware.test.ts. This file tests the wiring
// around it: the environment it reads, the cookies it is handed, and the response it builds.
//
// That wiring is exactly what typecheck cannot see. A middleware that throws takes every route on
// both products down at once while the types stay green, and the difference between a 307 and a
// 308 to /signin — which decides whether a browser keeps sending someone there after they have
// signed in — is not a type either.
//
// The environment is set before the import because middleware.ts reads it once, at module load.
// node --test gives each file its own process, so this affects nothing else.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

// Imported after the assignments above and not at the top of the file: the module reads the
// environment once, when it loads, the way it does in the edge runtime.
let middleware!: typeof import("../src/middleware").middleware;
before(async () => {
  ({ middleware } = await import("../src/middleware"));
});

const SESSION = "sb-abcdefgh-auth-token";

/**
 * Where a response sends the browser, or null when it sends them nowhere and serves the page.
 *
 * The status is deliberately not part of this. Two rules live in a sign-in redirect — that it
 * happens, and that it is the temporary kind — and if every test asserted both, either would
 * redden all of them. The cacheability test below owns the status on its own.
 */
function sentTo(response: Response): string | null {
  const location = response.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

function request(path: string, { host = "app.pickler.fun", cookie = "" } = {}) {
  const headers = new Headers({ host });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return new NextRequest(new URL(`https://${host}${path}`), { headers });
}

test("an anonymous request for the studio never reaches the studio", () => {
  assert.equal(sentTo(middleware(request("/account"))), "/signin");
});

test("the sign-in redirect is not cacheable, because it is about cookies and not about the URL", () => {
  // A 308, or a 307 a cache kept, would go on sending this browser to /signin after it signed in.
  const response = middleware(request("/account"));
  assert.notEqual(response.status, 308);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("the session cookie on the request is the session the guard reads", () => {
  assert.equal(sentTo(middleware(request("/account", { cookie: `${SESSION}=eyJhbGci` }))), null);
});

test("a chunked session cookie is read the same way", () => {
  const cookie = `${SESSION}.0=eyJhbGci; ${SESSION}.1=Zm9vYmFy`;
  assert.equal(sentTo(middleware(request("/account", { cookie }))), null);
});

test("the cookie a sign-in leaves behind on its way in is not a session", () => {
  const cookie = `${SESSION}-code-verifier=abc123`;
  assert.equal(sentTo(middleware(request("/account", { cookie }))), "/signin");
});

test("the studio's own front door is guarded", () => {
  assert.equal(sentTo(middleware(request("/"))), "/signin");
});

test("/studio is refused on the studio host, session or no session", () => {
  // Refused rather than redirected: nothing outside this repository has ever linked to it, and the
  // links inside resolve through `studioHref`. A 404 is a rewrite to /not-found, so it stays a 200
  // on the wire — `sentTo` is the check that it is not being sent anywhere.
  assert.equal(sentTo(middleware(request("/studio", { cookie: `${SESSION}=eyJhbGci` }))), null);
  assert.equal(middleware(request("/studio")).status, 404);
});

test("refusing /studio does not refuse the studio itself", () => {
  // Next does not re-run middleware on its own rewrite, so `/` still reaches the studio page.
  // Getting this wrong 404s the studio homepage for every visitor while typecheck stays green.
  const home = middleware(request("/", { cookie: `${SESSION}=eyJhbGci` }));
  assert.equal(home.status, 200);
  assert.equal(sentTo(home), null);
  assert.equal(home.headers.get("x-middleware-rewrite"), "https://app.pickler.fun/studio");
});

test("the marketplace refuses studio paths rather than forwarding them", () => {
  assert.equal(middleware(request("/account", { host: "pickler.fun" })).status, 404);
  assert.equal(sentTo(middleware(request("/account", { host: "pickler.fun" }))), null);
});

test("the paths sign-in needs are reachable with no cookies at all", () => {
  for (const path of ["/signin", "/signup", "/auth/callback", "/apply"]) {
    assert.equal(sentTo(middleware(request(path))), null, path);
  }
});

test("the marketplace is untouched by any of it", () => {
  assert.equal(sentTo(middleware(request("/leaderboard", { host: "pickler.fun" }))), null);
  assert.equal(sentTo(middleware(request("/", { host: "pickler.fun" }))), null);
});

test("the studio root keeps its query through the rewrite", () => {
  // Neither Next nor the OpenNext adapter merges the original query into a rewrite's target, and
  // the studio reads `?agent=` and `?section=` on the server: dropped here, every link to an agent
  // on the studio host opens on the first one.
  const home = middleware(request("/?agent=x&section=trading", { cookie: `${SESSION}=eyJhbGci` }));
  assert.equal(
    home.headers.get("x-middleware-rewrite"),
    "https://app.pickler.fun/studio?agent=x&section=trading",
  );
});

test("a refusal carries nothing of the request it refused", () => {
  const refused = middleware(request("/leaderboard?agent=x", { cookie: `${SESSION}=eyJhbGci` }));
  assert.equal(refused.status, 404);
  assert.equal(refused.headers.get("x-middleware-rewrite"), "https://app.pickler.fun/not-found");
});
