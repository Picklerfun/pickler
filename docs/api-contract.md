# API contract for mobile and web

The business API is the Hono Worker. Its route descriptions and portable Zod wire schemas
produce an OpenAPI 3.1 document with `hono-openapi`; no manually maintained JSON catalogue exists.

## Consume or export

After deployment, request `GET /api/v1/openapi.json` on the web host. The existing web transport
forwards it to `GET /v1/openapi.json` in the API Worker. The document is public; this does not grant
access to any operation. JWT, API-key, HMAC and application-cookie requirements describe the
existing middleware, not a new authorization mechanism. A JWT identifies its holder; it does not
prove a request came exclusively from our mobile binary or that a payment was made.

From the repository root, with Node 22.22+ and the committed dependencies:

```sh
npm run api:openapi -- --output /tmp/pickler-openapi.json
```

This builds shared packages, composes all route groups with services that throw if invoked,
checks coverage and unique operation ids, validates the document and its references, then writes
JSON. It loads no environment file and calls no database, model, RPC or wallet provider. CI runs
the same export and publishes the `pickler-openapi` downloadable artifact. Generated JSON is not
committed. The export is the complete development contract; the served document includes only
the optional route groups mounted in that deployment.

The document uses paths `/v1/...` and a relative server `/api`: together these address the web
proxy without duplicating `/v1`. `/health` is a direct Worker liveness route and carries a separate
server override; the web's catch-all does not proxy it. `/v1/console` and `/v1/demo` are documented
compatibility aliases with distinct operation ids, pointing to Studio and marketplace respectively.

The contract includes the current account join, Studio draft setup and identity editing, activity,
X verification and publication routes, wallet transfer ledger, Perpl market provenance and
limits, and the Perpl paper runtime's studio routes (manual checks, the decisions feed, paper
positions, owner close and stop, proposals and the record; approvals, closes and stops answer 202
and run in the research worker). Nullable venue counts and hourly reach remain unknown rather than becoming zero. When
these routes change, update their wire schemas and descriptions together.

## Add an endpoint

1. Define or reuse its request and response wire schemas in `@pickler/api-schema`. Do not expose
   internal repository records, lease tokens or credentials. Null and unknown values keep their
   actual meaning. Existing interface DTOs have corresponding checked schemas.
2. Add `operation("featureVerb", { response, body, security, ... })` next to the handler. Import
   the helper from `workers/api/src/openapi/operation.ts`. Specify success statuses, errors, query
   parameters and idempotency headers where relevant. Path parameters come from the mounted route.
   Use `user` only for verified user JWTs; `workspace` also accepts authorized API keys; `agent`
   additionally describes the three required HMAC headers; `apply` uses the HttpOnly seat cookie.
3. Keep runtime validation and authorization in their current handlers/middleware. The description
   helper does not validate requests or responses; changing input acceptance belongs in a separate
   behavioral change. Schemas for documented extension fields may carry arbitrary JSON, but whole
   response DTOs must have a concrete shape.
4. Add representative contract tests, run the export and relevant consumer checks. The OpenAPI
   coverage check rejects mounted operations without descriptions, response schemas or unique ids.

The complete export uses the **same** `createApp` and route factories as production. It is not a
second route registry. Services supplied by `documentationServices` are shape-only and cannot
execute business operations. API generation never executes endpoint handlers.

## Delivery boundary

The generated contract includes the JWT-only agent-advice group for asynchronous fresh
recommendations and shared completed history. See [Agent advice](agent-advice.md) for its
privacy, routing, disabled-by-default admissions and internal USD cost controls. It implements
no x402 payment flow or agent order execution. The mobile Ask backend imported in PR #71
remains separate; importing the app does not connect its screens to this harness automatically.

Merge does not establish remote availability. Deploy the API Worker through the existing release
process, then check the JSON through the web proxy and an authenticated read. This implementation
performs local controlled checks only and makes no provider calls or deployments.
