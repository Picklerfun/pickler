# passkey-domain — pickler.fun

Sirve el archivo `apple-app-site-association` (AASA) que autoriza a la app
iOS de Pickler (`2PBQJ37Q8W.fun.pickler.app`) a usar `pickler.fun` como
relying party de passkeys (WebAuthn / Sign in with Apple passkeys). iOS solo
habilita passkeys para un dominio si ese dominio sirve, sin redirect, el AASA
con el `appID` correcto en `https://<dominio>/.well-known/apple-app-site-association`.

Este directorio es un sitio estático desplegado en Cloudflare Pages (cuenta
**Pickler**, `1e08efc05d1cf361b372ba3009ed4985`), con dominio personalizado
`pickler.fun`.

## Contenido

- `public/.well-known/apple-app-site-association`: JSON sin extensión con
  `{"webcredentials":{"apps":["2PBQJ37Q8W.fun.pickler.app"]}}`.
- `public/_headers`: fuerza `Content-Type: application/json` en esa ruta
  (Cloudflare Pages sirve archivos sin extensión como `text/plain` u
  `octet-stream` por defecto; Apple exige `application/json`).
- `public/index.html`: placeholder para la raíz del dominio.
- `wrangler.jsonc`: configuración de Pages (`name`, `pages_build_output_dir`).

## Deploy

```bash
cd infra/passkey-domain
CLOUDFLARE_ACCOUNT_ID=1e08efc05d1cf361b372ba3009ed4985 wrangler pages project create pickler-passkeys --production-branch main
CLOUDFLARE_ACCOUNT_ID=1e08efc05d1cf361b372ba3009ed4985 wrangler pages deploy public --project-name pickler-passkeys --branch main
```

El primer comando solo es necesario una vez (crea el proyecto). El segundo
publica el contenido de `public/` y produce una URL tipo
`https://pickler-passkeys.pages.dev`.

El dominio personalizado `pickler.fun` se asocia desde el dashboard
(Workers & Pages → `pickler-passkeys` → Custom domains → Set up →
`pickler.fun`) o vía la API de Cloudflare Pages
(`POST /accounts/{account_id}/pages/projects/pickler-passkeys/domains`
con `{"name":"pickler.fun"}`). Pages **no** crea el registro DNS solo:
después de adjuntar el dominio hay que crear a mano, en la zona `pickler.fun`,
un **CNAME `pickler.fun` → `pickler-passkeys.pages.dev`, proxied** (nube
naranja) — desde el dashboard de DNS de la zona o vía la API con un token de
DNS de esa zona. Hasta que ese CNAME exista, el dominio queda en estado
`pending` en Pages con el motivo "CNAME record not set"; una vez creado el
registro, el certificado tarda unos minutos en activarse.

## Verificar

```bash
curl -sI https://pickler-passkeys.pages.dev/.well-known/apple-app-site-association
curl -sI https://pickler.fun/.well-known/apple-app-site-association
curl -s  https://pickler.fun/.well-known/apple-app-site-association
```

Se espera `HTTP/2 200`, `content-type: application/json`, **sin** cabecera
`location:` (o sea, sin redirect), y el cuerpo con
`2PBQJ37Q8W.fun.pickler.app`. El certificado del dominio personalizado puede
tardar varios minutos en activarse tras crearlo.

## Advertencia importante

**Cambiar el `rpId` (el dominio usado como relying party, hoy `pickler.fun`)
invalida todos los passkeys existentes de los usuarios.** Un passkey queda
ligado criptográficamente al dominio con el que se creó; si el dominio del
AASA o el `rpId` configurado en el cliente cambian, los usuarios deberán
re-registrar sus passkeys desde cero. Tratar este dominio como una decisión
permanente del producto, no como un valor de configuración trivial.
