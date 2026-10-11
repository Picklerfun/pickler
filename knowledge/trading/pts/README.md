# PTS trading course knowledge bundle

PTS describes trading with trend channels, Fibonacci levels, reversal and continuation patterns,
and market context. This bundle prepares the supplied course for reference retrieval and agent
analysis. Its execution parameters remain unresolved; it does not register or activate a strategy.

Knowledge version: **1.0.0**. Coverage: **29 Spanish text transcripts across four modules**. Videos
and course scripts are excluded. Normalized documentation is in English to follow repository
conventions; original Spanish text remains unchanged.

## Files and intended consumers

| File                                                               | Purpose                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [manual.md](manual.md)                                             | Readable explanation of the method, patterns, management and limitations.                           |
| [agent-context.md](agent-context.md)                               | Compact reference to include in a future authorized analysis request.                               |
| [rules.json](rules.json)                                           | Twenty-two concepts with course parameters, source references and unresolved questions.             |
| [candidate-policy.json](candidate-policy.json)                     | Proposed first analysis setup with explicit conditions and unset execution parameters.              |
| [open-questions.json](open-questions.json)                         | Decisions that need resolution before implementing executable PTS behavior.                         |
| [source-manifest.json](source-manifest.json)                       | Portable source paths, original filenames, hashes, word counts and line counts.                     |
| [sources](sources)                                                 | Original transcripts copied without textual changes, using stable filenames.                        |
| [retrieval/chunks.jsonl](retrieval/chunks.jsonl)                   | Complete course text split into fragments for future search or embedding.                           |
| [retrieval/concepts.jsonl](retrieval/concepts.jsonl)               | Normalized English concept cards with rule IDs and course citations.                                |
| [retrieval/manifest.json](retrieval/manifest.json)                 | Fragment format, coverage and indexing guidance.                                                    |
| [schemas](schemas)                                                 | JSON Schema contracts for rules, sources, candidate policy, retrieval records and analysis results. |
| [examples/analysis-request.json](examples/analysis-request.json)   | Proposed analysis request with no market evidence.                                                  |
| [examples/analysis-response.json](examples/analysis-response.json) | Matching example that preserves unknown findings and insufficient data.                             |
| [integration.md](integration.md)                                   | How a future consumer can use the bundle within existing project boundaries.                        |
| [bundle.json](bundle.json)                                         | File inventory and hashes for checking the delivered artifacts.                                     |

All paths in machine-readable files are relative to this directory. Source references use stable IDs
such as `M3C1` and **one-based inclusive** line ranges. A reference establishes what the course says;
it cannot establish that a current market meets a condition.

## Using the material

For explanations, read the compact context and retrieve the relevant manual sections or concept
cards. Consult the original transcript when resolving wording or a source citation. For analysis,
combine that reference material with separately sourced market observations and the proposed
condition contract in `candidate-policy.json`. The host must validate the result and preserve
unknown states when required evidence or policy definitions are missing.

The JSONL files contain text and metadata, without embeddings or a vector database dependency. A
future indexer can embed them using its reviewed provider, bind them to an authorized workspace and
filter by bundle ID, knowledge version and source IDs. No provider calls are needed to read these
files.

`agent-context.md` is longer than the existing Studio thesis field. It is intended as backend reference
context; do not paste it into the thesis or truncate it to fit. None of these files is automatically
loaded by the current agent.

## Review status

Module 3 lesson 6 was not supplied. Module 3 lesson 7 ends mid-sentence. Many examples refer to
diagrams absent from the text. Ratios, pattern geometry, instrument identities and confirmation
timings that need interpretation are listed in `open-questions.json`.

The course's risk percentages and claims about effectiveness remain attributed course statements.
They are not approved limits or measured performance. The candidate policy keeps execution disabled
and leaves all reviewed execution settings unset.
