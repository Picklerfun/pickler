import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POSTHOG_API_HOST_FALLBACK,
  POSTHOG_KEY_FALLBACK,
  posthogApiHost,
  posthogProjectKey,
  posthogRewrites,
  shareAnalyticsCookie,
} from "../src/features/analytics/config";
import {
  campaignProperties,
  waitlistFailureProperties,
  waitlistSignupProperties,
} from "../src/features/analytics/events";

test("campaign properties keep utm values and drop an email query", () => {
  const properties = campaignProperties(
    "?utm_source=newsletter&utm_medium=email&email=person@example.com&utm_campaign=launch",
  );
  assert.deepEqual(properties, {
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "launch",
  });
  assert.equal(JSON.stringify(properties).includes("person@example.com"), false);
});

test("a waitlist signup records the seat and not the address", () => {
  const properties = waitlistSignupProperties({
    search: "?utm_source=landing&ref=SECRET&email=person@example.com",
    path: "/create",
    alreadyJoined: false,
    position: 12,
    referralPresent: true,
  });
  assert.equal(properties.source, "create");
  assert.equal(properties.path, "/create");
  assert.equal(properties.already_joined, false);
  assert.equal(properties.position, 12);
  assert.equal(properties.referral_present, true);
  assert.equal(properties.utm_source, "landing");
  assert.equal("email" in properties, false);
  assert.equal("ref" in properties, false);
  assert.equal(JSON.stringify(properties).includes("person@example.com"), false);
  assert.equal(JSON.stringify(properties).includes("SECRET"), false);
});

test("a waitlist failure records the reason code and not the message", () => {
  const properties = waitlistFailureProperties({
    search: "",
    path: "/create",
    reason: "rejected",
    status: 400,
    errorCode: "invalid_email",
  });
  assert.deepEqual(properties, {
    source: "create",
    path: "/create",
    reason: "rejected",
    status: 400,
    error_code: "invalid_email",
  });
});

test("the project key and host fall back to Pickler Fun and honor a set value", () => {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const alias = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  try {
    assert.equal(posthogProjectKey(), POSTHOG_KEY_FALLBACK);
    assert.equal(posthogApiHost(), POSTHOG_API_HOST_FALLBACK);
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "  phc_from_env  ";
    assert.equal(posthogProjectKey(), "phc_from_env");
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com/";
    assert.equal(posthogApiHost(), "https://eu.i.posthog.com");
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://evil.example";
    assert.equal(posthogApiHost(), POSTHOG_API_HOST_FALLBACK);
  } finally {
    restore("NEXT_PUBLIC_POSTHOG_KEY", key);
    restore("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", alias);
    restore("NEXT_PUBLIC_POSTHOG_HOST", host);
  }
});

test("rewrites send static and array traffic to the asset host first", () => {
  assert.deepEqual(posthogRewrites("https://us.i.posthog.com"), [
    {
      source: "/ingest/static/:path*",
      destination: "https://us-assets.i.posthog.com/static/:path*",
    },
    {
      source: "/ingest/array/:path*",
      destination: "https://us-assets.i.posthog.com/array/:path*",
    },
    {
      source: "/ingest/:path*",
      destination: "https://us.i.posthog.com/:path*",
    },
  ]);
  assert.equal(
    posthogRewrites("https://eu.i.posthog.com")[0]?.destination,
    "https://eu-assets.i.posthog.com/static/:path*",
  );
});

test("the anonymous cookie is shared only across pickler.fun", () => {
  assert.equal(shareAnalyticsCookie("pickler.fun"), true);
  assert.equal(shareAnalyticsCookie("app.pickler.fun"), true);
  assert.equal(shareAnalyticsCookie("localhost:3000"), false);
  assert.equal(shareAnalyticsCookie("preview.workers.dev"), false);
  assert.equal(shareAnalyticsCookie("evilpickler.fun"), false);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
