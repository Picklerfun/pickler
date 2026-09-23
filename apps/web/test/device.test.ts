import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeBrowser,
  describeDevice,
  describePlatform,
  describePasskeyStore,
} from "../src/features/auth/lib/device";

// Real strings, copied from the browsers they name. A user agent invented for a test agrees with
// whatever the regular expression under test happens to do; these do not.
const AGENTS = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  firefoxWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
} as const;

test("each browser is named by its own token, not by the one every Chromium borrows", () => {
  assert.equal(describeBrowser(AGENTS.chromeMac), "Chrome");
  assert.equal(describeBrowser(AGENTS.safariMac), "Safari");
  assert.equal(describeBrowser(AGENTS.firefoxWindows), "Firefox");

  // The three that matter: every one of these strings also says "Chrome" or "Safari", so a
  // naive check in the wrong order names the wrong browser back at the person.
  assert.equal(describeBrowser(AGENTS.edgeWindows), "Edge");
  assert.notEqual(describeBrowser(AGENTS.edgeWindows), "Chrome");
  assert.equal(describeBrowser(AGENTS.samsungAndroid), "Samsung Internet");
  assert.notEqual(describeBrowser(AGENTS.samsungAndroid), "Chrome");
  assert.equal(describeBrowser(AGENTS.chromeIphone), "Chrome");
  assert.notEqual(describeBrowser(AGENTS.chromeIphone), "Safari");
});

test("each platform is named, and Android is never read as the Linux it also claims", () => {
  assert.equal(describePlatform(AGENTS.chromeMac), "macOS");
  assert.equal(describePlatform(AGENTS.safariIphone), "iOS");
  assert.equal(describePlatform(AGENTS.safariIpad), "iPadOS");
  assert.equal(describePlatform(AGENTS.edgeWindows), "Windows");
  assert.equal(describePlatform(AGENTS.firefoxLinux), "Linux");

  assert.equal(describePlatform(AGENTS.chromeAndroid), "Android");
  assert.notEqual(describePlatform(AGENTS.chromeAndroid), "Linux");
});

test("a string that names neither is null rather than a guess", () => {
  assert.equal(describeBrowser("Wget/1.21.4"), null);
  assert.equal(describePlatform("Wget/1.21.4"), null);
  assert.equal(describeBrowser(""), null);
  assert.equal(describePlatform(null), null);
  assert.equal(describeBrowser(undefined), null);
});

test("the device label falls back a segment at a time, never to a blank line", () => {
  assert.equal(describeDevice(AGENTS.chromeMac), "Chrome on macOS");
  assert.equal(describeDevice(AGENTS.safariIphone), "Safari on iOS");
  // A browser with no platform, and a platform with no browser, each keep what they have.
  assert.equal(describeDevice("Mozilla/5.0 Firefox/130.0"), "Firefox");
  assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0)"), "Windows");
  assert.equal(describeDevice("Wget/1.21.4"), "This device");
  assert.equal(describeDevice(null), "This device");
});

test("the passkey store is named only where the platform and the browser agree on one", () => {
  assert.equal(describePasskeyStore(AGENTS.safariMac), "iCloud Keychain");
  assert.equal(describePasskeyStore(AGENTS.safariIphone), "iCloud Keychain");
  assert.equal(describePasskeyStore(AGENTS.safariIpad), "iCloud Keychain");
  assert.equal(describePasskeyStore(AGENTS.edgeWindows), "Windows Hello");
  assert.equal(describePasskeyStore(AGENTS.chromeAndroid), "Google Password Manager");
  assert.equal(describePasskeyStore(AGENTS.samsungAndroid), "Google Password Manager");

  // Chrome on a Mac offers iCloud Keychain, its own profile or a phone, and the page cannot tell
  // which the person will pick. Naming one of them would be a guess printed as a fact.
  assert.equal(describePasskeyStore(AGENTS.chromeMac), null);
  assert.equal(describePasskeyStore(AGENTS.firefoxLinux), null);
  assert.equal(describePasskeyStore(null), null);
});
