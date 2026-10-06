# Controlled design verification

Read the root instructions and the instructions for any app inspected or changed. This directory
owns local fixture-based source, rendered design and screenshot checks. It does not authorize
provider calls, credentials, deployed activation or changes to trading experiments.

`lib/readiness.mjs` waits for the route's existing proof selector after client mounting and for
finite browser animations/transitions before measuring colours. Both waits are bounded; missing
screens and motion timeouts remain blocked. Infinite decorative animation does not extend a run.
Never change selectors, contrast thresholds or tokens to conceal a timing failure.

Run `node --test scripts/design/*.test.mjs`, root lint/format and `npm run design:check`.
The rendered harness requires globally installed Playwright and its own fixture/API ports.
Refuse occupied ports rather than stopping or measuring another checkout. Preserve explicit
`DESIGN_BASE_URL` attribution when an operator deliberately supplies a controlled server.
