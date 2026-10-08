# Controlled Studio acceptance

Read the root, API, Research, web and infrastructure instructions before changes here.
These scripts compose the existing compiled product with external HTTP fixtures only.
Never target an ordinary or deployed database, use real credentials, or stub product endpoints.
The dedicated Supabase stack must have its UUID marker on its dedicated fixed port 55522 or 55532 before any mutation.
Provider traffic stays on loopback; fixture entry points are never deployment configurations.
Keep credentials, screenshots, captures and generated configurations outside Git.
Acceptance establishes functionality with controlled providers, not provider readiness or profit.

See [reproduction and evidence](../../docs/studio-acceptance.md). `configure.mjs` generates private
bindings, `migrate.mjs` fences the existing infrastructure migrator, and `build-web.mjs` injects
only dedicated local public Auth settings for compilation. `providers.mjs` serves allowlisted
synthetic transports; `acceptance.mjs` drives genuine passkey and Studio requests with Chromium.
The root `test:studio-local` command takes the generated stack directory. Never add remote URLs,
provider retries, endpoint response stubs or `?stage=` shortcuts to make acceptance pass.

## Dynamic Studio markets

See the canonical selection/version, preservation and controlled acceptance boundaries below. No
runtime activation is implied.

See [agent-selected Perpl markets](../../docs/studio-perpl-markets.md).

## Controlled X authorization

The loopback provider simulates only X's external consent/token/identity/revoke/timeline endpoints.
Authorization codes are single-use and the provider validates S256 verifiers. The browser replaces
only X's external consent page with a controlled redirect; the actual Studio API, cookie callback,
core, private PostgreSQL, publication and posts are exercised unchanged. Generated X credentials
and quotas are test-only. Production transports never import this fixture. See
[Studio X OAuth](../../docs/studio-x-oauth.md).
