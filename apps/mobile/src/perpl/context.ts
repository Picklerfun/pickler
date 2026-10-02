import { type Context, parseContext, parseServerTime } from "@pickler/perpl-context";
import { CONTEXT_TIMEOUT_MS } from "./config";

// El parser vive en @pickler/perpl-context, compartido con el tablero de la web; aquí sólo queda la red.
export { type Context, type Instance, type Market, parseContext, parseServerTime } from "@pickler/perpl-context";

export async function fetchContext(rest: string): Promise<Context> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    const res = await fetch(`${rest}/v1/pub/context`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Perpl responded ${res.status}`);
    const serverTime = parseServerTime(res.headers.get("date"), res.headers.get("age"));
    return { ...parseContext(await res.json()), serverTime };
  } finally {
    clearTimeout(timer);
  }
}
