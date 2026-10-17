# Offline PTS causal research catalog

Read the repository root, `../pts/AGENTS.md`, `../pts-versions/AGENTS.md`,
`../../../packages/trading/AGENTS.md` and the consuming host's instructions before changes.

This directory owns the immutable `pts-research-candidates-v1` reference catalog, four disabled
single-change policy descriptions, JSON Schemas, non-executable manifest examples, decision
provenance and methodological evidence. It is not a workspace package or a financial strategy
registry. Trading owns pure detectors; agent-service owns local file verification and reports.

- Keep every published candidate at `0.1.0` immutable. A changed threshold, interpretation, schema
  or documentation record needs a new version; never overwrite a prior identity.
- Pin the exact byte SHA-256 of the original course bundle, responsive baseline and each policy.
  Keep byte hashes distinct from the host's canonical semantic hashes.
- Candidate policy JSON must match the trading-owned `PTS_RESEARCH_CANDIDATES` constants.
  Validate catalog, descriptors, policies and examples with the agent-service catalog test.
- Keep research identities outside `PtsVersion`, immutable account policies, financial config
  resolvers, Studio, executable registry selections and public trial preparation.
- Every arm changes one factor relative to `pts-intraday@0.2.0-fast.2`; never stack candidates.
  No risk, size, fee, funding, fill, exit or SMA policy belongs in this catalog.
- Preserve source transcripts, the original candidate catalog and all existing financial policies
  byte for byte. Reference material cannot grant execution or provider permissions.
- Treat examined candles and repeated episode rows as development evidence. Signals are not fills;
  unknown lifecycle coverage cannot become an entry, and candles cannot establish net returns.
- Manifest examples are syntactic references with explicit nonexistent private inputs. Do not
  commit private captures, environment files, databases, credentials or runnable public configs.
- Keep documentation in English. Record primary-source limitations and experimental parameter
  provenance; neither course claims nor literature results prove Perpl five-minute profitability.

From the repository root, after building shared packages, run:

```sh
node --import tsx --test apps/agent-service/test/pts-research-catalog.test.ts
```

See [README.md](README.md), [DECISIONS-1.0.0.md](DECISIONS-1.0.0.md) and
[the local guide](../../../apps/agent-service/PTS-CAUSAL-RESEARCH.md).
