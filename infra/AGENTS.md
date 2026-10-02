# Infra instructions

Read [the root instructions](../AGENTS.md) first.

Two small Cloudflare projects that exist for one file: the `apple-app-site-association` that lets
the iOS app (`2PBQJ37Q8W.fun.pickler.app`) use `pickler.fun` as the relying party of its Mera
passkey. Each has a README in Spanish with its deploy steps.

- [`aasa-worker/`](aasa-worker/README.md) is the one in service: a Worker on the exact zone route
  `pickler.fun/.well-known/apple-app-site-association`, in front of whatever serves the rest of the
  host.
- [`passkey-domain/`](passkey-domain/README.md) is the Pages project that served the file before
  the host pointed at the web; it is kept as the fallback.

`apps/web/public/.well-known/apple-app-site-association` carries the same association. All three
must name the same app identifier, and none may be removed while a build of the app is installed
anywhere: without the file iOS refuses the passkey, and with it the wallet. `pickler.fun` is Mera's
relying party on every surface ([the specification](../docs/specs/mobile-monorepo-v1.md), W1); it
does not move.

Deploying either project needs the Cloudflare account that owns the zone and is done only when
asked.
