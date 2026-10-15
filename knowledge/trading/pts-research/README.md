# Offline PTS causal research candidates

`pts-research-candidates-v1` records four disabled, independent hypotheses against the frozen
`pts-intraday@0.2.0-fast.2` baseline. It describes an offline causal signal analysis, with no
financial execution, Studio selection or public trial. Each candidate has its own `0.1.0` identity.

| Candidate                   | Only changed factor           | Question                                                                                                              |
| --------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `primary-er20@0.1.0`        | Primary trend                 | Does a directional-efficiency definition remove a particular primary-trend bottleneck?                                |
| `persistent-setups@0.1.0`   | Setup selection and lifecycle | Does retaining previously confirmed geometry expose entries hidden by latest-only selection?                          |
| `ready-band-entry@0.1.0`    | Entry trigger                 | Can the first closed candle after complete readiness provide a causal entry when an earlier cross was not yet usable? |
| `retracement-control@0.1.0` | Retracement band              | How sensitive are results to one equal-width non-Fibonacci development control?                                       |

The engine evaluates baseline plus each candidate independently. It never combines ER20,
persistence, ready-band entry and the control band into one arm. These identities are not
`PtsVersion` values, account policies, financial configurations or strategy-registry entries.

| Artifact                                                     | Meaning                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [catalog.json](catalog.json)                                 | Versioned catalog, exact reference pins and descriptor hashes.                          |
| `<id>/0.1.0.json`                                            | Disabled candidate descriptor, policy byte hash and decision-record reference.          |
| `<id>/0.1.0/policy.json`                                     | Exact trading-owned research policy object, without financial permissions.              |
| [schemas](schemas)                                           | Strict catalog, descriptor, policy and input-manifest contracts.                        |
| [examples/input-manifest.json](examples/input-manifest.json) | Schema-valid shape with nonexistent input files and declared placeholder source hashes. |
| [DECISIONS-1.0.0.md](DECISIONS-1.0.0.md)                     | Experimental choices, examined evidence and provenance.                                 |
| [LITERATURE-1.0.0.md](LITERATURE-1.0.0.md)                   | Six primary-source records and the limits of transferring their findings.               |

The [course bundle](../pts/bundle.json) remains `pts-course@1.0.0`. Its original transcripts,
unresolved execution questions and the disabled `0.1.0` candidate remain intact. The
[responsive baseline](../pts-versions/pts-intraday/0.2.0-fast.2/policy.json) is an independently
interpreted executable policy; this research catalog is another distinct layer. Ratios discussed
by the course do not mandate the new numerical settings.

Paths in a catalog or descriptor resolve against the file containing that path. Input-manifest
paths resolve against that manifest. Policy byte hashes include the actual committed JSON bytes;
the host separately records canonical semantic hashes for analyzed objects. No hash is a
profitability claim or execution authorization.

See [the local guide](../../../apps/agent-service/PTS-CAUSAL-RESEARCH.md) for the offline command,
evidence categories and conditioned future protocol. A changed published artifact needs a new
version. No automatic promotion, parameter search or public comparison follows from this catalog.
