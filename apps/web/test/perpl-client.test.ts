import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { perplRequest, PerplReadError } from "../src/features/perpl/client";

const signal = new AbortController().signal;

test("enrollment rejection never claims an existing read key expired or exposes provider prose", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: "AUTHORIZATION_REJECTED",
        message: "private provider payload must never reach the UI",
      },
      { status: 400 },
    ),
  );

  await assert.rejects(
    perplRequest("read-key/enroll", z.object({}), signal, "controlled", {}),
    (error: unknown) => {
      assert.ok(error instanceof PerplReadError);
      assert.equal(error.code, "AUTHORIZATION_REJECTED");
      assert.match(error.message, /registration/);
      assert.doesNotMatch(error.message, /expired|private provider/);
      return true;
    },
  );
});

test("Pickler JWT rejection is distinct from rejection of a Perpl read signature", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
  );

  await assert.rejects(
    perplRequest("portfolio", z.object({}), signal, "controlled", {}),
    (error: unknown) => {
      assert.ok(error instanceof PerplReadError);
      assert.equal(error.code, "PICKLER_SESSION_EXPIRED");
      return true;
    },
  );
});
