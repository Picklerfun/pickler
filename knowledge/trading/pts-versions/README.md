# Independent PTS candidate versions

`pts-trend-reversal/0.1.0.json` names a **draft, unregistered, disabled** candidate. Its knowledge
reference is `pts-course@1.0.0`; neither version is a strategy-registry selection. The descriptor
pins the exact course inventory and original proposed policy by SHA-256. No detector or executable
PTS policy is implemented, and unresolved definitions and execution parameters remain `null`.

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
