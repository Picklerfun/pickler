// AASA (apple-app-site-association) para passkeys: autoriza a la app iOS de Pickler a usar
// pickler.fun como relying party. Mismo contenido que infra/passkey-domain/public/.well-known/.
// Apple exige 200 directo (sin redirect) y Content-Type application/json.
const AASA = JSON.stringify({ webcredentials: { apps: ["2PBQJ37Q8W.fun.pickler.app"] } });

export default {
  fetch(request: Request): Response {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    return new Response(request.method === "HEAD" ? null : AASA, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
} satisfies ExportedHandler;
