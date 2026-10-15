/** Formatting only. Financial values and risk estimates are prepared by the API. */
export function number(value: string | null, digits = 2) {
  if (value === null) {
    return "—";
  }
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n)
    : "—";
}

export function money(value: string | null) {
  if (value === null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function signedMoney(value: string | null) {
  return `${value !== null && Number(value) > 0 ? "+" : ""}${money(value)}`;
}

export function tone(value: string | null) {
  if (value === null || Number(value) === 0) {
    return "neutral";
  }
  return Number(value) < 0 ? "loss" : "good";
}

export function percent(bps: string | null, signed = false, digits = 2) {
  if (bps === null) {
    return "—";
  }
  const value = Number(bps) / 100;
  if (value !== 0 && Math.abs(value) < 10 ** -digits) {
    return `${value < 0 ? "−" : signed ? "+" : ""}<${10 ** -digits}%`;
  }
  return `${signed && value > 0 ? "+" : ""}${number(String(value), digits)}%`;
}

export function price(value: string | null) {
  return number(value, Math.abs(Number(value)) < 1 ? 8 : 2);
}

export function clock(at: string) {
  return new Date(at).toLocaleTimeString("en-GB", { timeZone: "UTC" });
}

export function marketHref(symbol: string) {
  return `/markets/${encodeURIComponent(symbol.endsWith("-PERP") ? symbol : `${symbol}-PERP`)}`;
}
