# Fast verification for Pickler iOS

**Date:** 2026-10-15  
**Status:** Approved design; implementation not started  
**Scope:** Pickler's Expo iOS development, visual verification, phase closure, and release workflows

## Vision

Pickler should answer two different questions with two different costs:

1. Did this application change behave correctly in development?
2. Is this exact native binary ready to distribute?

Today, ordinary JavaScript or TypeScript work can reach the same expensive native preparation used
for a TestFlight archive. The new verification contract introduces four explicit levels—`quick`,
`visual`, `phase`, and `release`—so evidence remains proportional to the claim being made.

A JavaScript-only change reuses the installed development client and Metro. A native-sensitive
change is detected from a reproducible fingerprint and requires a rebuild before visual or phase
evidence can be accepted. Release remains conservative: the existing clean prebuild and clean
archive behavior is preserved.

## Why now

The final verification step has become the slowest part of otherwise small mobile changes. The main
cost is not the changed screen itself; it is repeating Expo prebuild, dependency preparation, and an
Xcode build even when the native project would be identical.

This has three consequences:

- Small copy, style, and application-logic changes receive feedback too late.
- Development verification and release packaging are treated as one operation even though they
  establish different evidence.
- A long total duration cannot currently be attributed to fingerprinting, Metro, native build,
  installation, visual traversal, or packaging.

The project keeps the strict release path while making the common development path observable and
incremental.

## Verification contract

### `quick`

The default inner loop for application changes. It runs the relevant focused tests and type checks,
records timing data, and reports whether the native fingerprint is current.

For a JavaScript- or TypeScript-only change with a matching native fingerprint, `quick` must not
invoke Expo prebuild, CocoaPods, or Xcode. A dirty native fingerprint is surfaced as an explicit
rebuild requirement; the runner must never silently claim that the installed client is current.

### `visual`

The interactive UI check for the flows affected by the change. It reuses the installed development
client and Metro when the native fingerprint matches, then records startup and traversal timing.

If native-sensitive inputs changed, visual verification is blocked until the development client is
rebuilt. Simulator evidence is valid only for behavior the simulator can actually exercise. A real
Face ID prompt and its physical-device behavior require an iPhone; simulator enrollment or mocked
state is not equivalent evidence.

### `phase`

The comprehensive local gate used once when closing an implementation phase. It composes the
project's required tests, type checks, and visual evidence without automatically turning the run
into a distribution archive. It may reuse a fingerprint-matched development build. If the phase
contains native-sensitive changes, it includes the required development rebuild before acceptance.

Phase closure records the exact commands, fingerprint result, cache result, stage durations, and
the device or simulator used. It does not publish a build.

### `release`

The distribution gate. It preserves the current clean preparation and archive semantics, including
clean Expo prebuild and clean Xcode archive, signing, and export. It runs only when a release or
TestFlight build is intentionally requested and separately authorized.

Development cache reuse must never weaken the clean release path. The release report uses the same
timing schema, but a cache hit in `quick` or `visual` cannot substitute for a successful release
archive.

## Native fingerprint

The runner calculates a deterministic fingerprint from inputs that can alter the generated native
project or installed binary. The initial contract includes:

- workspace and mobile package manifests plus the portion of the committed lockfile reachable from
  the mobile workspace dependency closure, not unrelated monorepo packages;
- the evaluated Expo configuration under an explicit allowlist of environment inputs, including the
  effective associated domains, entitlements, permissions, and bundle identifiers; values that affect
  the binary are hashed but never emitted raw in reports;
- Expo config sources and config plugins, including `app.config.ts` and plugin implementation inputs;
- explicitly authored native override sources and dependency metadata when present;
- icons, splash resources, entitlements, permissions, and other assets embedded by prebuild or the
  native build;
- the relevant Expo, React Native, Node, Xcode, and platform/toolchain versions.

Ordinary application JavaScript, TypeScript, tests, non-native documentation, the generated `ios/`
prebuild tree, Pods, and build outputs are excluded unless a file is an explicitly authored native
override or is imported by a native configuration input. The fingerprint implementation must expose
its input classes and dependency-closure decision for inspection and testing rather than relying on
an undocumented directory-wide hash.

The installed development client's recorded fingerprint is compared with the current fingerprint.
A match permits reuse. A mismatch identifies the changed input class and requires a new development
build before `visual` or native-dependent `phase` acceptance.

## Timing and cache report

Every level emits a human-readable summary and a machine-readable record with, where applicable:

- fingerprint calculation;
- cache lookup and result (`hit`, `miss`, or `not_applicable`);
- prebuild and native dependency preparation;
- Xcode compilation or archive;
- client installation and launch;
- Metro readiness;
- focused tests and type checking;
- visual traversal;
- signing/export; and
- total elapsed time.

Skipped stages are reported as skipped, not as zero-cost work. Failures retain completed stage
durations so the expensive step remains identifiable. Time budgets are observational in this
project; hard performance thresholds require a later measured baseline and are not introduced by
this spec.

## Key decisions

| Decision | Rationale |
|---|---|
| Separate `quick`, `visual`, `phase`, and `release` | Each level establishes different evidence and should pay only for the work that evidence requires. |
| Reuse the development client only on an exact native fingerprint match | Fast Refresh is safe for application-only changes, while native drift remains explicit and fail-closed. |
| Keep clean prebuild and clean archive for release | Distribution reproducibility and signing confidence are more important than development speed. |
| Record stage timings and cache state | Total wall-clock time alone cannot distinguish compilation from setup, UI traversal, or cache misses. |
| Require a physical iPhone for real Face ID evidence | The simulator cannot prove the real biometric prompt or Secure Enclave interaction. |
| Keep project-specific runners | A future cross-project rule may share vocabulary and reporting, but it must not couple Pickler's Expo/Xcode implementation to unrelated repositories. |

## Acceptance criteria

The implementation is accepted only when controlled tests demonstrate both sides of the routing
decision:

- With only JavaScript or TypeScript application inputs changed and a matching native fingerprint,
  `quick` and `visual` do not invoke Expo prebuild, CocoaPods, or Xcode.
- Changing a declared native input changes the fingerprint and prevents stale-client visual
  acceptance until the rebuild path succeeds.
- Changing dependency, plugin, embedded asset, or `app.config.ts` fixtures is covered by controlled
  fingerprint tests.
- Changing an allowlisted environment fixture such as `PICKLER_RP_ID` changes the fingerprint and
  prevents reuse, while the raw value never appears in the report.
- Changing only an unrelated workspace dependency or a generated `ios/`, Pods, or build-output
  fixture does not invalidate the native fingerprint.
- The existing release path still performs a clean prebuild and clean archive; a controlled test
  fails if either clean operation is removed or bypassed.
- Reports distinguish cache hits from misses and contain per-stage plus total elapsed times.
- Visual evidence names the runtime target, and real Face ID acceptance names a physical device.

Tests must also be run against the defect: the JavaScript-only fixture must fail if a prebuild or
Xcode invocation is injected, and the native-change fixture must fail if the runner incorrectly
reuses the stale client.

## Roadmap

### F1 — Runner, native fingerprint, and timings

Define the command surface for the four levels, implement the inspectable native fingerprint and
development-client cache record, route JavaScript-only work away from native builds, and emit
stage-level timing/cache reports. Cover both the no-native-build path and the forced-rebuild path
with controlled negative tests.

**Deliverable:** a measured runner that can prove why the development client was reused or rebuilt.

### F2 — Visual acceptance and separate phase/release gates

Integrate affected-flow visual verification with the reused client and Metro, record simulator or
device evidence, compose the phase-closing gate, and preserve the clean prebuild/archive release
path as a distinct operation. Document the physical-device requirement for real Face ID acceptance.

**Deliverable:** explicit visual, phase, and release workflows whose reports cannot be confused with
one another.

## Out of scope

- Implementing the runner or choosing its final script names in this specification stage.
- Changing product screens, application behavior, signing identities, or TestFlight distribution.
- Removing clean prebuild or clean archive from the release workflow.
- Claiming real Face ID acceptance from a simulator.
- Introducing mandatory duration thresholds before a baseline is measured.
- Creating the future global verification skill or editing rules outside the Pickler repository.
- Extending this first implementation to Android or to non-mobile Pickler services.

