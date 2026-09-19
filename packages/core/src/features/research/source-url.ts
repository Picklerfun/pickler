/** Resource validation, never a grant of tool permissions. No network requests here. */
export function publicSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && !["80", "443"].includes(url.port))
    ) {
      return null;
    }
    // Require public DNS names. Literal IPs (including normalized numeric IPv4),
    // single-label names and local suffixes are not source resources.
    if (
      !host.includes(".") ||
      host.includes(":") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
