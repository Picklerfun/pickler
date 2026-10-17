# Independent PTS candidate versions

`pts-trend-reversal/0.1.0.json` names a **draft, unregistered, disabled** candidate. Its knowledge
reference is `pts-course@1.0.0`; neither version is a strategy-registry selection. The descriptor
pins the exact course inventory and original proposed policy by SHA-256. That 0.1.0 draft has no detector or executable
policy; its unresolved definitions and execution parameters remain `null`.

- [Original reference bundle](../pts/README.md)
- [Candidate descriptor](pts-trend-reversal/0.1.0.json)
- [Catalog schema](schemas/candidate.schema.json)
- [Valid example](examples/candidate.json)
- [Baseline export and recovery](../../../apps/agent-service/TRADING-BASELINE.md)

Published candidate versions are immutable. New criteria or parameter definitions get a new
candidate version. Documentation revisions also record their own version and description; do not
silently replace an existing descriptor. The implementation commit is recorded in the backup
manifest, independently of the candidate and knowledge versions. A future executable delivery
requires reviewed, frozen rules, a separate strategy identity and explicit operator selection.
Existing SMA, risk, prompt, model and acquisition versions remain unchanged.

## Independently frozen local candidate 0.2.0

[PTS basic 0.2.0](pts-trend-reversal/0.2.0.json) and its
[separate schema](schemas/candidate-v2.schema.json) pin the original course and a new explicit
experimental policy. [Eleven decisions](pts-trend-reversal/0.2.0/DECISIONS.md) resolve the basic
operational choices with source references. The public pure contract is implemented only for
the local v8 laboratory. Studio selection and deployed execution remain disabled.

See [preparation and offline reproduction](../../../apps/agent-service/PTS-BASIC-PAPER.md).
The fourteen-day run is a separate explicit action, and no market is eligible without sufficient
original Perpl history. Versions 0.1.0 and pts-course@1.0.0 are not rewritten or completed in place.

## Independent intraday candidate

[pts-intraday@0.1.0](pts-intraday/0.1.0.json) and its [decision record](pts-intraday/0.1.0/DECISIONS.md)
freeze native shorter temporal roles for local paper evaluation. The v3 schema is independent;
original v1/v2 descriptors, course and basic PTS remain unchanged. No Studio activation is implied.
