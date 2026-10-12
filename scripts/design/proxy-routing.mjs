// Build the Web Worker with the synthetic public Supabase values in middleware-request.test.ts.
// Run it through workerd locally with no live service bindings or provider credentials.
// Node's HTTP transport preserves Host; undici fetch may replace it with the URL's host.
import assert from "node:assert/strict";
import http from "node:http";

function request(path, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get(base + path, { headers, timeout: 30000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          headers: new Headers(response.headers),
          text: async () => body,
        }),
      );
    });
    outgoing.on("error", reject);
    outgoing.on("timeout", () => outgoing.destroy(new Error("Local Worker response timed out")));
  });
}

const base = process.env.PROXY_BASE_URL || "http://127.0.0.1:8833";
const target = new URL(base);
assert.equal(target.protocol, "http:", "Controlled checks require loopback HTTP");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  "Never run this suite against a deployed Worker",
);
assert.equal(target.username + target.password, "", "No credentials in the target URL");

const session = "sb-abcdefgh-auth-token.0=controlled; sb-abcdefgh-auth-token.1=fixture";
const cases = [
  {
    name: "anonymous Studio root",
    host: "app.pickler.fun",
    path: "/?agent=controlled&section=token",
    status: 307,
    location: "/signin?next=%2F%3Fagent%3Dcontrolled%26section%3Dtoken",
    private: true,
  },
  {
    name: "anonymous account",
    host: "app.pickler.fun",
    path: "/account",
    status: 307,
    location: "/signin?next=%2Faccount",
    private: true,
  },
  {
    name: "anonymous deep Studio route",
    host: "app.pickler.fun",
    path: "/studio/agents/controlled/token?network=testnet",
    status: 307,
    location: "/signin?next=%2Fstudio%2Fagents%2Fcontrolled%2Ftoken%3Fnetwork%3Dtestnet",
    private: true,
  },
  { name: "marketplace account refusal", host: "pickler.fun", path: "/account", status: 404 },
  {
    name: "Studio duplicate root refusal",
    host: "app.pickler.fun",
    path: "/studio",
    status: 404,
    cookie: session,
  },
  {
    name: "Studio marketplace refusal",
    host: "app.pickler.fun",
    path: "/agents",
    status: 404,
    cookie: session,
  },
  {
    name: "callback host and query",
    host: "pickler.fun",
    path: "/auth/callback?code=controlled&next=%2Faccount",
    status: 307,
    location: "https://app.pickler.fun/auth/callback?code=controlled&next=%2Faccount",
    private: true,
  },
  { name: "sign-in accessible", host: "app.pickler.fun", path: "/signin", status: 200 },
  {
    name: "chunked cookie reaches account",
    host: "app.pickler.fun",
    path: "/account",
    status: 200,
    cookie: session,
  },
  {
    name: "PKCE cookie is not session",
    host: "app.pickler.fun",
    path: "/account",
    status: 307,
    location: "/signin?next=%2Faccount",
    cookie: "sb-abcdefgh-auth-token-code-verifier=controlled",
    private: true,
  },
  { name: "public create page", host: "pickler.fun", path: "/create", status: 200 },
  {
    name: "Studio root rewrite",
    host: "app.pickler.fun",
    path: "/?agent=controlled&section=token",
    status: 200,
    cookie: session,
  },
];

for (const scenario of cases) {
  const response = await request(scenario.path, {
    host: scenario.host,
    ...(scenario.cookie ? { cookie: scenario.cookie } : {}),
  });
  const body = await response.text();

  assert.equal(response.status, scenario.status, scenario.name + ": " + body.slice(0, 180));
  assert.equal(response.headers.get("location"), scenario.location ?? null, scenario.name);
  if (scenario.private) {
    assert.equal(response.headers.get("cache-control"), "private, no-store", scenario.name);
  }
  console.log("Passed:", scenario.name);
}
console.log(
  "Controlled workerd routing passed: 12 scenarios; no live bindings or provider credentials.",
);
