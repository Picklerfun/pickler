# Staging Worker Builds configuration

This guide configures Cloudflare Workers Builds connected to `Picklerfun/pickler`.
These settings remain current until the opt-in
[coordinated GitHub Actions cutover](../../docs/staging-deployment-pipeline.md) is completed.
Do not keep independent main deployments enabled after that cutover. For database operations, access controls, deployment
order, and remote acceptance, follow [staging operations](../../docs/cloudflare-staging.md).

## Common dashboard settings

For each Worker, open **Settings → Build** and use:

- Repository: `Picklerfun/pickler`.
- Production branch: `main`.
- Root directory: `/`.
- Excluded build watch paths: empty.
- Enter each included watch path as its own chip. A single space-separated entry does not
  represent multiple filters and can prevent builds from starting.
- Build Variables and Secrets: `NODE_VERSION=24.19.0` and
  `SKIP_DEPENDENCY_INSTALL=true`.

The commands below explicitly install npm 10.9.3 and dependencies. Do not rely on
`NPM_VERSION`: the Workers build image documentation does not list it as a supported version
selector. Build variables are separate from runtime variables and secrets.

## API, research, and trading

Use this build command for all three:

```sh
npm install --global npm@10.9.3 && npm ci && npm run build:shared
```

| Worker                     | Deploy command                                                    | Included build watch paths                                                                       |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pickler-api-staging`      | `npx wrangler deploy --config workers/api/wrangler.staging.jsonc` | `workers/api/*, packages/*, scripts/*, package.json, package-lock.json, turbo.json, .npmrc`      |
| `pickler-research-staging` | `npx wrangler deploy --config workers/research/wrangler.jsonc`    | `workers/research/*, packages/*, scripts/*, package.json, package-lock.json, turbo.json, .npmrc` |
| `pickler-trading-staging`  | `npx wrangler deploy --config workers/trading/wrangler.jsonc`     | `workers/trading/*, packages/*, scripts/*, package.json, package-lock.json, turbo.json, .npmrc`  |

Disable non-production branch deployments for these backends. Preserve existing runtime
secrets; do not copy them into Build Variables and Secrets or GitHub repository secrets.

## Indexer

Prepare `pickler-indexer-staging` as the fifth independent publisher. It reads canonical testnet events;
it has no signing key, transaction submission, metadata writes or paid provider capability.
Use the same locked install/shared build command as API, research and trading, then:

```sh
npx wrangler deploy --config workers/indexer/wrangler.jsonc
```

Use `Picklerfun/pickler`, production branch `main`, root `/`, and disable non-production branch
builds. Include each watch path as a separate chip:

```text
workers/indexer/*, packages/*, scripts/*, docs/market/*, package.json, package-lock.json, turbo.json, .npmrc
```

The existing runtime has two separately provisioned public policies, `TOKEN_LAUNCH_POLICY_JSON`
and `TOKEN_INDEXER_POLICY_JSON`. The indexer configuration uses `keep_vars=true` to retain them
on publication ([Wrangler variable preservation](https://developers.cloudflare.com/workers/wrangler/configuration/#environment-variables)).
Variables explicitly declared in the Wrangler file still take precedence. Verify
the reviewed policy contents/hashes and trusted `DATABASE` Hyperdrive binding before connecting;
never copy backend secrets, local env files or the launch grant key into Builds.

On 11 October 2026 the hosted indexer had no Git connection and still served manually published
version `7a59bf87`, despite newer indexer code on main. The owner launch was confirmed at block
70,237,021; the factory cursor at 23:45 UTC was 70,167,887. The public profile consequently returned
no confirmed token. A recent cursor timestamp and `stale=false` do not mean caught up.

Merge the configuration fix before connecting the existing Worker so its initial automatic
build retains the reviewed runtime policies. Connecting grants persistent deployment access;
review the repository and deploy credential scope explicitly. Saving a connection does not prove
publication: inspect the actual main commit, successful build and active version, then measure
cursor progress without moving it, skipping history or increasing the existing RPC limits.
Once canonical launch/grant attribution is present, the existing landing token cards link to the
public agent profile and its visitor-wallet Buy/Sell form. Complete an explicit human-confirmed
faucet purchase/sale before reporting remote trading acceptance. See
[public token trading](../../docs/market/public-token-trading.md).

## Web

For `pickler-web-staging`, use:

```sh
npm install --global npm@10.9.3 && npm ci && npm run build --workspace=@pickler/api-schema && npm run build:worker --workspace=@pickler/web
```

Deploy command:

```sh
npx wrangler deploy --config apps/web/wrangler.jsonc
```

Included build watch paths:

```text
apps/web/*, packages/*, scripts/*, package.json, package-lock.json, turbo.json, .npmrc
```

In addition to the two common build variables, supply the public staging values:

| Build variable                         | Value                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Staging project's Supabase URL                                       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Staging project's public publishable key or existing legacy anon key |
| `NEXT_PUBLIC_OAUTH_X_ENABLED`          | `false` until X OAuth is configured                                  |

Next.js embeds these public values during compilation; runtime-only configuration does not
replace the browser bundle's values. Missing Supabase public configuration can still allow
pages to render, but does not establish working authentication. Ignored local environment
files are not automatically available in remote Git builds. Never use a Supabase service-role
or secret key in a `NEXT_PUBLIC_*` variable.

The runtime variable `NEXTJS_ENV=production` is already declared in the web Wrangler file.
If presentation-only branch previews are enabled, use
`npx wrangler preview --config apps/web/wrangler.jsonc`; their configuration excludes backend
service bindings. Configure their public build variables separately when authentication UI
needs them.

## Existing resources and activation

Queues and Hyperdrive are resources, not independently built projects. Committed Wrangler
files bind existing `pickler-research-staging`, `pickler-trading-queue-staging`, and
`pickler-database-staging` resources. Keep backend provider and custody secrets in runtime
settings. Advice requires a reviewed policy on API and research; configuration of Builds
does not supply that policy or authorize paid calls.

Separate Worker Builds do not enforce deployment order or apply PostgreSQL migrations.
For coordinated changes, follow the staging guide: migrations first when required, then
consumers, API, and web. Keep advice and trading admissions closed until their separate
acceptance requirements are met. A successful build is not proof of remote readiness.

This guide lives under `scripts/*`, which is intentionally included in the watch filters.
Merging a change here can trigger the production-branch builds without modifying
business behavior. Inspect each deployment result afterward.

After correcting a repository connection, merge a documentation-only change under `scripts/*`
to exercise the configured watch filters. Verify a successful main-branch build and the active
deployment separately for each Worker; saving dashboard settings alone is not deployment proof.

Official references: [build image and version selectors](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/),
[Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
and [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).
