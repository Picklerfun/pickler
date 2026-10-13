# OpenAPI instructions

Read the root, API Worker and api-schema instructions first.

This directory owns transport documentation helpers, controlled composition for export, and
coverage checks. Business logic and credentials do not belong here. Route descriptions live beside
handlers; reusable wire schemas live in api-schema. Documentation middleware must not parse,
reject or rewrite live requests. The mounted Hono routes are authoritative; never maintain a
second endpoint catalogue. Export composition must throw if any service method is invoked.

Every explicit HTTP operation needs a description, unique operation id, concrete success/error
schemas and accurate security. Opaque JSON is allowed only for documented extension fields.

`operation` also takes `headers` (extra request headers, such as advice's `X-PAYMENT`; a header's
optional `schema` replaces the default `{ type: "string" }`, e.g. a base64 `contentSchema`) and
`responses` (a status with its own JSON body, documented over the error statuses, such as the
advice 402). `responseHeaders` documents headers of the success response.

Redirect operations use `redirect: true` to document Location without inventing JSON success
bodies. Studio's X callback is the sole X operation without bearer JWT; its description must
state the single-use state, PKCE and HttpOnly cookie protections. All other X routes remain
owner JWT-only and private/no-store. See [Studio X OAuth](../../../../docs/studio-x-oauth.md).

`operation.ts` supports explicit response media schemas for immutable token JSON/SVG assets.
JSON remains the default for ordinary operations; asset reads do not inherit private Studio
authentication or permit public writes.

Documentation composition includes `perplDashboard` by default for the read-only market, scope-1
enrollment and signed-wallet route group. An explicit feature selection can omit it. Like every
other export service, this group is shape-only and throws if invoked while generating the document.
