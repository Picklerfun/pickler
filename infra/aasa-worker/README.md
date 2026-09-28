# aasa-worker — AASA de passkeys en `pickler.fun` por ruta de Worker

Desde el 2026-09-20 el DNS de `pickler.fun` es un `CNAME` (proxied) al worker de la web
(`pickler-web-staging.gilbertsahumada.workers.dev`), que no sirve
`/.well-known/apple-app-site-association`; sin ese archivo iOS rechaza los passkeys de la
app («iOS refused a passkey for pickler.fun»). Este worker responde **sólo** esa ruta
(ruta de zona exacta) con el mismo JSON que `infra/passkey-domain` (Pages
`pickler-passkeys`, que ya no está detrás del dominio) y deja el resto de la web intacto.

```bash
cd infra/aasa-worker
npx wrangler@latest deploy          # OAuth de Jesús (cuenta Pickler); el token DNS del .env raíz no basta
curl -si https://pickler.fun/.well-known/apple-app-site-association | head -5
# esperado: 200, content-type: application/json, {"webcredentials":{"apps":["2PBQJ37Q8W.fun.pickler.app"]}}
```

El CDN de Apple (`https://app-site-association.cdn-apple.com/a/v1/pickler.fun`) cachea la
respuesta anterior (llegó a cachear el 404); tarda en refrescar. En el iPhone, reinstalar la
app desde TestFlight fuerza a iOS a volver a pedir el AASA.
