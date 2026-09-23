// Which browser and which platform the person is looking at, read out of the user agent string.
//
// It exists for words on a screen and for nothing else. The ceremony sheet names the browser and
// the platform back — "CHROME · MACOS" — so that the prompt about to appear is recognisable as
// this browser's own, and the wallet screen names the device it has just saved a passkey on. No
// decision anywhere in this feature is taken on what these functions return.
//
// A user agent is a claim, not a fact, and every Chromium browser claims to be Chrome while
// Chrome on an iPhone also claims to be Safari. So the order of the tables below is the whole of
// the correctness here, and anything unrecognised comes back as null: the caller leaves the
// segment out rather than printing a guess, or printing the word "UNKNOWN" at somebody.

interface Rule {
  readonly name: string;
  readonly test: RegExp;
}

/** Specific tokens before general ones: every entry below `Edge` also carries `Chrome/`. */
const BROWSERS: readonly Rule[] = [
  { name: "Edge", test: /\bEdg(?:e|A|iOS)?\// },
  { name: "Opera", test: /\bOPR\/|\bOPiOS\/|\bOpera\// },
  { name: "Samsung Internet", test: /\bSamsungBrowser\// },
  { name: "Firefox", test: /\bFirefox\/|\bFxiOS\// },
  { name: "Chrome", test: /\bChrome\/|\bCriOS\// },
  { name: "Safari", test: /\bSafari\// },
];

/** Android before Linux, because an Android user agent says both and only one of them is useful. */
const PLATFORMS: readonly Rule[] = [
  { name: "iPadOS", test: /\biPad\b/ },
  { name: "iOS", test: /\biPhone\b|\biPod\b/ },
  { name: "Android", test: /\bAndroid\b/ },
  { name: "macOS", test: /\bMacintosh\b|\bMac OS X\b/ },
  { name: "Windows", test: /\bWindows\b/ },
  { name: "Linux", test: /\bLinux\b|\bX11\b/ },
];

const match = (rules: readonly Rule[], userAgent: string | null | undefined): string | null =>
  (userAgent ? rules.find((rule) => rule.test.test(userAgent))?.name : undefined) ?? null;

export const describeBrowser = (userAgent: string | null | undefined): string | null =>
  match(BROWSERS, userAgent);

export const describePlatform = (userAgent: string | null | undefined): string | null =>
  match(PLATFORMS, userAgent);

/**
 * "Chrome on macOS", or as much of it as the string admits to, down to "This device".
 *
 * The wallet screen puts this against the SAVED tag, so it has to name something rather than
 * leave the row blank: a row with no label reads as a passkey that went nowhere.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const browser = describeBrowser(userAgent);
  const platform = describePlatform(userAgent);
  if (browser && platform) {
    return `${browser} on ${platform}`;
  }
  return browser ?? platform ?? "This device";
}

/**
 * Where the passkey is about to be kept — "iCloud Keychain", "Windows Hello" — or null.
 *
 * Only named where the platform and the browser leave one answer. Chrome on a Mac offers iCloud
 * Keychain, its own profile and a phone, and this page cannot tell which the person will pick, so
 * it says nothing and the sheet prints the domain alone. Under-claiming costs a line; naming the
 * wrong store teaches someone to expect their passkey somewhere it is not.
 */
export function describePasskeyStore(userAgent: string | null | undefined): string | null {
  const browser = describeBrowser(userAgent);
  const platform = describePlatform(userAgent);
  const apple = platform === "macOS" || platform === "iOS" || platform === "iPadOS";
  if (apple && browser === "Safari") {
    return "iCloud Keychain";
  }
  if (platform === "Windows" && (browser === "Chrome" || browser === "Edge")) {
    return "Windows Hello";
  }
  if (
    platform === "Android" &&
    (browser === "Chrome" || browser === "Edge" || browser === "Samsung Internet")
  ) {
    return "Google Password Manager";
  }
  return null;
}
