/** Safe local timing projection. Unknown phases stay unknown instead of being inferred. */
export function timingReport(text: string) {
  const allowed = [
    "version",
    "cycle",
    "operation",
    "at",
    "durationMs",
    "timerDelayMs",
    "queryId",
    "statement",
    "code",
    "status",
    "phase",
    "queueMs",
    "headersMs",
    "bodyMs",
    "validationMs",
  ];
  const rows = text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line) as Record<string, unknown>;
      return Object.fromEntries(
        allowed
          .filter(
            (k) =>
              value[k] === null ||
              typeof value[k] === "number" ||
              (typeof value[k] === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value[k] as string)),
          )
          .map((k) => [k, value[k]]),
      );
    })
    .filter((v) => typeof v.durationMs === "number");
  const operations = [...new Set(rows.map((r) => String(r.operation ?? "lease-renewal")))]
    .sort()
    .map((operation) => {
      const values = rows
        .filter((r) => String(r.operation ?? "lease-renewal") === operation)
        .map((r) => r.durationMs as number)
        .sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return {
        operation,
        count: values.length,
        medianMs: values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2,
        p95Ms: values[Math.ceil(values.length * 0.95) - 1]!,
      };
    });
  const csv =
    [
      allowed.join(","),
      ...rows.map((r) =>
        allowed
          .map((k) => {
            const value = String(r[k] ?? "");
            const safe = /^[=+\-@]/.test(value) ? "'" + value : value;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      ),
    ].join("\n") + "\n";
  return { version: 1, rows, operations, csv };
}
