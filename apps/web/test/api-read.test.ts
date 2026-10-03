import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_LEADERBOARD,
  emptyAnalytics,
  readOrEmpty,
  readOrNull,
  readVenueItemOrNull,
} from "../src/server/api-read";

/* A public board whose API is behind the web renders its empty screen, not a 500. One behaviour
   per test. */

const json = (status: number, body: unknown = { error: { code: "X", message: "x" } }) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const quiet = <T>(run: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  console.warn = () => {};
  return run().finally(() => {
    console.warn = warn;
  });
};

test("a 200 passes the data through, not degraded", async () => {
  assert.deepEqual(await readOrEmpty(json(200, [1, 2]), "/x", []), {
    data: [1, 2],
    degraded: false,
  });
});

test("a 404 (a route the deployed API does not have yet) is the empty value, degraded", async () => {
  assert.deepEqual(await quiet(() => readOrEmpty(json(404), "/x", [])), {
    data: [],
    degraded: true,
  });
});

test("a 503 is the empty value, degraded", async () => {
  assert.deepEqual(await quiet(() => readOrEmpty(json(503), "/x", EMPTY_LEADERBOARD)), {
    data: EMPTY_LEADERBOARD,
    degraded: true,
  });
});

test("a degraded read logs one line naming the path and the status", async () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => lines.push(line);
  try {
    await readOrEmpty(json(404), "/marketplace/directory", []);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [{ event: "api_degraded", path: "/marketplace/directory", status: 404 }],
  );
});

test("a 401 is not skew: it still throws", async () => {
  await assert.rejects(readOrEmpty(json(401), "/x", []), /\(401\)/);
});

test("a 400 still throws", async () => {
  await assert.rejects(readOrEmpty(json(400), "/x", []), /\(400\)/);
});

test("one item that is not found is null", async () => {
  assert.equal(await readOrNull(json(404), "/x/1"), null);
});

test("one item behind a 502 is null", async () => {
  assert.equal(await quiet(() => readOrNull(json(502), "/x/1")), null);
});

test("one item on a 403 still throws", async () => {
  await assert.rejects(readOrNull(json(403), "/x/1"), /\(403\)/);
});

test("empty analytics keep the range that was asked", () => {
  assert.equal(emptyAnalytics("7d").range, "7d");
});

test("empty analytics fall back to 30d for a range the board does not offer", () => {
  assert.equal(emptyAnalytics("1y").range, "30d");
});

test("a venue that is down is an error, not a market that does not exist", async () => {
  await assert.rejects(
    quiet(() => readVenueItemOrNull(json(503), "/marketplace/markets/BTC-PERP")),
    /temporarily unavailable/,
  );
  assert.equal(await readVenueItemOrNull(json(404), "/marketplace/markets/NOPE-PERP"), null);
  assert.equal(await quiet(() => readVenueItemOrNull(json(502), "/x/1")), null);
});
