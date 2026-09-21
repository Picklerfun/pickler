import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface ApiBinding {
  fetch(request: Request): Promise<Response>;
}

/** Transport only: the API verifies identity and owns every business decision. */
export async function apiFetch(request: Request): Promise<Response> {
  const local = process.env.PICKLER_API_LOCAL_URL;
  if (local) {
    const target = new URL(local);
    if (
      target.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    ) {
      throw new Error("PICKLER_API_LOCAL_URL must be loopback HTTP");
    }
    const source = new URL(request.url);
    target.pathname = source.pathname;
    target.search = source.search;
    const response = await fetch(new Request(target, request), { cache: "no-store" });
    /* fetch negotiates compression with the local worker and hands back a decoded body, but the
       headers still describe the encoded one. Passing those on verbatim tells the browser to
       gunzip plain JSON, which fails the request before any handler sees it. The body we are
       returning is the decoded one, so the headers that measured the encoded one have to go. */
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const { env } = await getCloudflareContext({ async: true });
  const binding = (env as unknown as { API?: ApiBinding }).API;
  if (!binding) {
    throw new Error("Missing API service binding");
  }
  return binding.fetch(request);
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(new Request(`https://pickler.internal/v1${path}`, init));
  if (!response.ok) {
    throw new Error(`Pickler API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
