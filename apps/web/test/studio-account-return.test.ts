import assert from "node:assert/strict";
import { test } from "node:test";
import { profileFromStudio, studioReturnHref } from "../src/features/studio/shell/account-return";
import { stageFromSearch } from "../src/features/studio/home/stage";

test("profile return preserves the selected workspace and current section over stale URL state", () => {
  const profile = new URL(
    profileFromStudio("/studio", "?stage=draft&agent=old&resume=overview&secret=private", {
      agent: "selected",
      section: "master",
    }),
    "http://localhost",
  );
  assert.equal(profile.pathname, "/account");
  assert.equal(profile.searchParams.get("section"), "profile");
  assert.equal(
    studioReturnHref(profile.searchParams.get("returnTo")!, "/studio"),
    "/studio?stage=draft&agent=selected&resume=master",
  );
});

test("dedicated Studio returns to root while shared hosts keep /studio", () => {
  const profile = new URL(
    profileFromStudio("/", "", { agent: "selected", section: "brief" }),
    "https://app.pickler.fun",
  );
  assert.equal(
    studioReturnHref(profile.searchParams.get("returnTo")!, "/"),
    "/?agent=selected&resume=brief",
  );
  assert.equal(studioReturnHref(undefined, "/studio"), "/studio");
  assert.equal(studioReturnHref(undefined, "/"), "/");
});

test("account cannot redirect to other origins, routes or shared-host marketplace home", () => {
  for (const asked of [
    "https://evil.example/studio",
    "//evil.example/studio",
    "/\\evil.example/studio",
    "javascript:alert(1)",
    "/account",
    "/studio/other",
    "/studio#anything",
    "/?agent=selected",
    "studio?agent=selected",
  ]) {
    assert.equal(studioReturnHref(asked, "/studio"), "/studio", asked);
  }
  assert.equal(studioReturnHref("/studio?agent=selected", "/"), "/");
  assert.equal(studioReturnHref("/studio", "https://app.pickler.fun/"), "https://app.pickler.fun/");
});

test("return strips unrelated parameters and cannot enable production fixtures", () => {
  assert.equal(
    studioReturnHref("/studio?unknown=secret&agent=a&agent=b&stage=draft", "/studio"),
    "/studio?stage=draft&agent=a",
  );
  assert.equal(stageFromSearch("production", "draft"), undefined);
});
