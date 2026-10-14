# Network selector and mainnet readiness

## First delivery

The marketplace (`pickler.fun`) and Studio (`app.pickler.fun`) share one Next.js app and one
product network control. `NetworkSelector` is present in the landing's own `LandingNav`, the
marketplace's `SiteNav`, and the Studio home, creation and draft/live top bars. It is available
without a connected wallet.

The native `Select` exported by `@pickler/ui` follows the light/dark control tokens. The web's
presentation catalogue uses the existing metadata from `@pickler/chain`: Monad Testnet (10143)
is selected; Monad Mainnet (143) is shown as **Mainnet — Coming soon** and disabled. Its accessible
description explains the restriction. Opening the selector never connects a wallet, asks for a
signature, submits a transaction or changes backend configuration. The selection is rendered the
same on the server and client. With only one available network, no preference storage is needed.

This delivery does not enable mainnet, migrate agents or change funds. The catalogue is a
presentation description, not authorization. This selector introduces no environment flag that
enables Mainnet. Any future deployment network change must also update this catalogue in coordination
with backend readiness.

## Agent research findings

The research was split between a frontend agent (navigation, host routing, wallets and state),
a backend agent (configuration and network isolation), and the coordinating implementation agent.

| Finding                                                                                                 | Evidence                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both products share an app; Studio owns its subdomain root.                                             | [Host routing](../apps/web/src/server/hosts.ts)                                                                                                             |
| Browser wallet operations target Testnet. Mera and Turnkey are separate wallet systems.                 | [Wallet provider](../apps/web/src/features/wallet/lib/provider.ts), [web instructions](../apps/web/AGENTS.md)                                               |
| The API selects financial adapters through a global `CHAIN_ID`.                                         | [API composition](../workers/api/src/container.ts)                                                                                                          |
| Marketplace Perpl data has its own global network setting.                                              | [Growth services](../workers/api/src/growth/services.ts)                                                                                                    |
| New drafts explicitly use Perpl Testnet.                                                                | [Draft creation](../packages/core/src/features/studio/create.ts)                                                                                            |
| Agent creation does not populate `agents.chain_id`. Wallet deposits and transfers lack chain isolation. | [Studio directory](../packages/infrastructure/src/studio/directory.ts), [wallet persistence](../packages/infrastructure/src/persistence/product/wallets.ts) |
| Stamped creation ceremonies may continue after unmount to complete confirmation.                        | [Creation screen](../apps/web/src/features/studio/new-agent/new-agent.tsx)                                                                                  |

Changing only a frontend label or calling a browser wallet's switch-chain method cannot change
the Studio backend network. Chain metadata is available for both networks, but availability of
metadata does not establish product readiness.

## Requirements before enabling Mainnet

These are requirements for a future delivery, not implemented capabilities:

- Validate a request-scoped product network in the API, resolve RPC/adapters per network and keep
  Perpl data consistent with the same selected environment.
- Fix an agent's network at creation; populate chain IDs, filter listings and isolate balances,
  deposits, transfers, histories and transaction deduplication by network. Backfill existing
  records as Testnet only when their origin is established.
- Keep identity shared while financial data remains isolated. Selecting another environment
  must not reinterpret or migrate an existing agent.
- Share the preference between apex and Studio with a server-validated mechanism. Origin-local
  `localStorage` alone cannot meet this requirement. Define fallback and disabled-network handling
  when introducing persistence.
- Stop network-scoped polling and reject late responses on transition. Reset forms, selected
  agents, caches and idempotency keys. Block transitions during signatures, transfers and
  uncertain mutations; confirmations must validate the original agent and transaction network.
- Parameterize marketplace wallet reads and chain switching, handling user rejection. Preserve
  Mera/Turnkey relying-party and code boundaries and the documented mainnet security prerequisites.
- Reverify RPC metadata, contracts, permissions and remote acceptance before opening Mainnet.
  Migration of existing agents requires a separate, explicit design.

## Verification

Check native keyboard navigation, disabled Mainnet, accessible name/description, mobile wrapping,
light/dark styling and consistent Testnet selection across product navigation and reloads. Use
controlled fixtures for visual checks; no provider calls or financial transactions are required.
Run the relevant web/UI typechecks, lint, formatting, build and design checks. Local checks do
not establish deployed mainnet readiness.

Local validation on 2026-10-14 passed: web production build, web/UI typechecks, lint, scoped
Prettier, architecture/link checks and 62 host-routing, import-boundary and Studio landing tests.
The design harness passed surfaces, tokens, contrast and typography on the landing, home, creation,
draft and published Studio fixtures. Desktop/mobile screenshots were inspected. Browser checks
at 1400px and 390px confirmed disabled Mainnet, accessible description, keyboard behavior,
restoration of Testnet after a synthetic change, reload persistence and viewport fit. Navigation
from the marketplace to Studio retained Testnet, with no API mutations or page/hydration errors.
