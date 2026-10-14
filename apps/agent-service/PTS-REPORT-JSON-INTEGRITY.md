# PTS report JSON integrity

## Reproduced defect

The historical `pts-report-manifest-v2` writer hashed the in-memory report with the unchanged
`canonicalAudit` rules, but published the report using native JSON semantics. An optional
`undefined` object field contributes `null` to that historical digest and disappears from JSON.
Dates, sparse arrays and `toJSON` values can also differ. Consequently, correct individual file
hashes do not establish that `reportHash` can be reproduced from the published JSON.

The controlled regression includes optional values, nested fields, a Date and a sparse array.
It fails against the old writer and checks the digest of parsed published JSON independently.
A separate stateful `toJSON` test requires the hash to use the publication pass rather than a
second serialization. These fixtures perform no financial execution or provider calls.

## New publication contract

New output uses `pts-report-manifest-v3` with
`reportHashPolicy: "sha256-canonical-published-json-v1"`:

- `report.json` preserves native JSON values and sorts object keys by the existing UTF-16
  canonical comparison. Array order and element values remain unchanged.
- `reportHash` is SHA-256 of those same streamed canonical JSON chunks, without the final newline.
  It equals `digest(JSON.parse(reportJson))` for the published document.
- `files` and `fileBytes` still verify exact bytes, including the final newline, for every output.
- Publication remains bounded and atomic per file, with the manifest published last. A failed
  serialization cannot publish a success manifest.

Default `jsonChunks`/`jsonDocument` semantics and the historical `digest`, `canonicalAudit`,
source payload and financial policy hashes remain unchanged. No whole-document JSON clone is
introduced. V1/v2 source exports remain readable; existing report manifests are never rewritten
or relabeled. The format version distinguishes the new report-hash meaning explicitly.

## Verification and limits

`test/pts-report-json-integrity.test.ts` verifies native-value parity, canonical numeric key
ordering, a single serialization pass, independent file hashes and deterministic publication.
`test/pts-report-capacity.test.ts` retains bounded container publication, Unicode, atomic failure,
legacy canonical bytes, segmented source parity and offline CLI guards.

A corrected offline audit must use the original hash-verified source export and a new directory.
Compare decision rows, financial values and policy/source hashes before accepting that rendering.
Keep any original failed manifest and its diagnosis as evidence. Correcting a report cannot resume
an interrupted process, close pending positions, repair historical coverage or demonstrate PTS
profitability. A hardware suspension and a report-hash mismatch require separate evidence; neither
should be inferred to have caused the other.
