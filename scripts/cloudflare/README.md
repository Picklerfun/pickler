# Staging Worker Builds configuration

This guide configures Cloudflare Workers Builds connected to `Picklerfun/pickler`.
It does not configure GitHub Actions. For database operations, access controls, deployment
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

This guide lives under `scripts/*`, which is intentionally included in all four watch filters.
Merging a change here can trigger all four production-branch builds without modifying
business behavior. Inspect each deployment result afterward.

After correcting a repository connection, merge a documentation-only change under `scripts/*`
to exercise the configured watch filters. Verify a successful main-branch build and the active
deployment separately for each Worker; saving dashboard settings alone is not deployment proof.

Official references: [build image and version selectors](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/),
[Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
and [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).
