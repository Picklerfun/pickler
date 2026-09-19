import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryApplicantStore } from "../src/index.js";

const application = {
  agentName: "Pick",
  ticker: "$PICK",
  xHandle: "@pickbot",
  category: "Sports",
  personality: "Analyst",
  edge: "e",
  whyYou: "w",
} as const;

test("in-memory store issues a token once and counts referrals that applied", async () => {
  const { waitlist, applicants } = createInMemoryApplicantStore({
    initialCount: 1204,
    reservedTickers: ["$HALF"],
  });

  const ana = await waitlist.join("ana@x.io", null);
  assert.equal(ana.position, 1205);
  assert.ok(ana.applyToken);
  assert.equal((await waitlist.join("ana@x.io", null)).applyToken, null);

  const anaSeat = (await applicants.findByToken(ana.applyToken!))!;
  const bo = await waitlist.join("bo@x.io", anaSeat.referralCode);
  assert.equal((await applicants.findByToken(ana.applyToken!))!.referrals, 0);

  assert.equal(
    await applicants.submit(bo.applyToken!, { ...application, ticker: "$HALF" }),
    "ticker_taken",
  );
  assert.equal(await applicants.submit(bo.applyToken!, application), "submitted");
  assert.equal(await applicants.submit(bo.applyToken!, application), "already_submitted");
  assert.equal(
    await applicants.submit(ana.applyToken!, {
      ...application,
      ticker: "$ANA",
      xHandle: "@PICKBOT",
    }),
    "handle_taken",
  );
  assert.equal(await applicants.isTickerAvailable("$PICK"), false);
  assert.equal((await applicants.findByToken(ana.applyToken!))!.referrals, 1);
  assert.equal(await applicants.findByToken("nope"), null);
});
