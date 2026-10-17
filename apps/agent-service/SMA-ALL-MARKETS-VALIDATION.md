# All-markets comparison validation record

The local v5 implementation was checked before any paid contract or prospective request.
Controlled transports are fixtures and are not evidence of live provider accuracy.

- `npm test`: 2,841 discovered; 2,840 passed, zero failed, one unrelated explicit fork skip.
  PostgreSQL integration tests ran against disposable local databases.
- `node --import tsx --test apps/agent-service/test/perps-universe.test.ts`: all twelve passed
  after the final scoped historical-acknowledgment and evidence-hash changes.
- `npm run typecheck`, `npm run lint`, and `npm run build:shared`: passed.
- `npm run build --workspace=@pickler/agent-service`: Mastra Node bundle passed.
- API, Research and Trading `build:worker`: dry-run bundles passed; nothing was deployed.
- Root Prettier formatting and the architecture check are included in the checks above.

The controlled PostgreSQL run demonstrated five long openings, five short openings, and
complete exits in each of the three independent portfolios. It exercised joint reservations,
per-asset calls, one shared final refresh, duplicate fencing, technical-stop accounting,
permission revocation, bounded acquisition, and exactly 264 report identities. Controlled
requests never consumed Jev or Exa. Synthetic frame hashes cover the adjusted market identities.

The first restricted Worker build could not write Wrangler's user log. It was repeated as a
local dry run with that filesystem access. The unrelated Web/Turbopack build was interrupted
while optimizing; it is not a changed consumer. No remote build or financial acceptance follows
from these local checks.

The public catalog snapshot on 2026-10-07 confirmed all eleven planned IDs, open markets,
AUSD collateral and a 2,580-second funding interval. This is a free catalog check, separate from
paid contract validation and the prospective run.

A new private study directory contains the explicit operator authorization, configuration,
catalog and documentary budget proof. Historical exact campaign spend cannot be reconstructed
from the recovered database. The conservative historical upper bound is USD 1.177674386,
including the full previous authorizations and all four known unknown reservations. Together
with the USD 2.50 new reservation ceiling it stays below the original USD 5 campaign ceiling.
A shared hash on the two multiframe failures does not merge their distinct call identities.

Paid contract results and prospective results must be reported separately after execution.
This record does not claim those phases have already passed or that the strategy is profitable.
