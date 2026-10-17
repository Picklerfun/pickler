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
- Paste included watch paths as a comma-separated list, using the values below. The dashboard
  converts each path into its own chip; verify the saved entries before starting a build. A single
  space-separated entry does not represent multiple filters and can prevent builds from starting.
- Build Variables and Secrets: `NODE_VERSION=22.23.2` and
  `SKIP_DEPENDENCY_INSTALL=true`.

The commands below explicitly install npm 10.9.3 and dependencies. Do not rely on
`NPM_VERSION`: the Workers build image documentation does not list it as a supported version
selector. Build variables are separate from runtime variables and secrets.

As of 12 October 2026, the official Workers build image includes Node 22.23.2. This pin satisfies the repository's Node 22.22+ requirement; a listed preinstalled version does
not establish that a particular remote installer run will succeed. Recheck the official build image before changing the pin. The dashboard build
variable is authoritative; editing a local `.env` or a Wrangler runtime variable does not
change the Node version selected before the build command starts.

### Recovering a Node installation failure

If a build ends at `Installing nodejs ...` with `Failed: error occurred while installing tools
or dependencies`, the repository's build command has not started. On 12 October 2026 (UTC) the web
build of main commit `a21124a4574ad1290656a6bb05e9e7bdafb39629` and its retry failed at this
step while selecting Node 24.19.0. An owner-approved retry with Node 22.23.2 also failed there.
The API build of the same commit installed Node 24.19.0 successfully. The previous web release
remained active; these observations do not establish a bad Node release or an application error.

In the affected Worker's **Settings → Build → Build Variables and Secrets**, save
`NODE_VERSION=22.23.2`, then retry the failed main build through the existing Cloudflare pipeline.
Preserve the other build variables, runtime bindings and secrets. Do not substitute a manual
Wrangler deployment. A saved version pin is a proposed recovery, not proof of success: verify
that the next log selects the expected Node version, that the build and publication finish,
and that the active release serves the intended public page before reporting completion.

If the installer still fails with the intended version, stop changing versions speculatively.
Use **Clear cache** under the affected Worker's build settings to remove regenerable build
artifacts, preserving variables and the cache setting, then perform one clean retry. Clearing
cache does not change the active release. If the same installation boundary remains broken,
retain the failed build IDs and the matching successful control build for Cloudflare support;
no successful publication or cause has been established.

The clean web retry `e755c830-7d54-49f3-bc33-63e21953134a` subsequently completed the build
and automatic deployment for the same main commit, publishing version
`5f41bd19-f94a-408c-a4df-3c83eb57a28e`. The normal public agent profile at
[the confirmed token profile](https://pickler.fun/agents/teterabob) then loaded the real price,
valuation, curve progress and distribution from the public API. Its history and recent trades
were empty because no curve trades were recorded. The successful clean retry establishes
recovery after clearing the cache; it does not establish why the earlier installer failed or
that the version pin alone resolved it. Only the web build variable was changed; the other
Workers, runtime bindings and secrets were preserved.

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
