// What the runner does about the two servers is decided by a pure function, so every position of
// the decision is pinned here without starting anything.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { BASE_URL, listening, plan, webEnv } from "./lib/servers.mjs";

test("with both ports free the runner starts the servers and measures its own", () => {
  assert.deepEqual(plan({ baseUrl: undefined, fixtureBusy: false, webBusy: false }), {
    start: true,
    baseUrl: BASE_URL,
    refuse: null,
  });
});

test("a named server is measured as it is, and nothing is started beside it", () => {
  const decided = plan({ baseUrl: "http://localhost:3001", fixtureBusy: true, webBusy: true });

  assert.deepEqual(decided, { start: false, baseUrl: "http://localhost:3001", refuse: null });
});

test("a taken web port is refused rather than measured on a guess", () => {
  const decided = plan({ baseUrl: undefined, fixtureBusy: false, webBusy: true });

  assert.equal(decided.start, false);
  assert.match(decided.refuse, /port 3001 already in use/);
});

test("a taken fixture port is refused too, and both are named when both are taken", () => {
  assert.match(
    plan({ baseUrl: undefined, fixtureBusy: true, webBusy: false }).refuse,
    /port 8799 already in use/,
  );
  assert.match(
    plan({ baseUrl: undefined, fixtureBusy: true, webBusy: true }).refuse,
    /port 8799 and 3001 already in use/,
  );
});

test("the web app is pointed at the fixture with authentication switched off", () => {
  const env = webEnv({ PATH: "/bin", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" });

  assert.equal(env.PATH, "/bin");
  assert.equal(env.PICKLER_API_LOCAL_URL, "http://127.0.0.1:8799");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "");
});

test("a port something listens on is seen, and a free one is not", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.equal(await listening(port), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await listening(port), false);
});
