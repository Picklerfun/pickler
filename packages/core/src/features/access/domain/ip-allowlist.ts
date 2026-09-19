// Ported from Relayer apps/api/src/core/auth/ip-allowlist/cidr-matcher.util.ts (commit bb6bb1226e92).
// `net.BlockList` is not available on Workers, so IPv4/IPv6 CIDR matching is done with bigint.
// Behaviour change: a malformed CIDR entry never matches instead of throwing; an allowlist made
// only of malformed entries therefore denies every address (fail-closed).

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(ip: string): bigint | null {
  const match = IPV4.exec(ip);
  if (!match) {
    return null;
  }
  let value = 0n;
  for (const part of match.slice(1)) {
    if (part.length > 1 && part.startsWith("0")) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(ip: string): bigint | null {
  if (!ip.includes(":") || ip.split("::").length > 2) {
    return null;
  }
  let text = ip;
  // Embedded IPv4 tail, e.g. ::ffff:10.0.0.1
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === null) {
      return null;
    }
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (rest === undefined ? missing !== 0 : missing < 1) {
    return null;
  }
  const groups = [
    ...headGroups,
    ...Array<string>(rest === undefined ? 0 : missing).fill("0"),
    ...tailGroups,
  ];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null;
    }
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

type Address = { family: 4 | 6; value: bigint };

function parseAddress(ip: string): Address | null {
  const v4 = parseIpv4(ip);
  if (v4 !== null) {
    return { family: 4, value: v4 };
  }
  const v6 = parseIpv6(ip);
  return v6 === null ? null : { family: 6, value: v6 };
}

function matches(address: Address, cidr: string): boolean {
  const [base, prefixText, extra] = cidr.trim().split("/");
  if (!base || prefixText === undefined || extra !== undefined || !/^\d{1,3}$/.test(prefixText)) {
    return false;
  }
  const network = parseAddress(base);
  if (!network || network.family !== address.family) {
    return false;
  }
  const bits = network.family === 4 ? 32n : 128n;
  const prefix = BigInt(Number(prefixText));
  if (prefix > bits) {
    return false;
  }
  const shift = bits - prefix;
  return address.value >> shift === network.value >> shift;
}

/** True when there is no restriction (null or empty list) or the IP falls inside any CIDR. */
export function isIpAllowed(clientIp: string, allowedCidrs: readonly string[] | null): boolean {
  if (!allowedCidrs || allowedCidrs.length === 0) {
    return true;
  }
  // IPv4-mapped IPv6 addresses are matched against IPv4 rules.
  const address = parseAddress(clientIp.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ""));
  if (!address) {
    return false;
  }
  return allowedCidrs.some((cidr) => matches(address, cidr));
}
