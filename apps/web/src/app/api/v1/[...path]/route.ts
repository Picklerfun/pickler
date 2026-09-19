import { apiFetch } from "@/server/api-client";

async function delegate(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api\/v1(?=\/|$)/, "/v1");
  return apiFetch(new Request(url, request));
}
export {
  delegate as GET,
  delegate as POST,
  delegate as PUT,
  delegate as PATCH,
  delegate as DELETE,
  delegate as OPTIONS,
  delegate as HEAD,
};
