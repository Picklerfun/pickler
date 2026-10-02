# Mobile docs tooling instructions

Read [the root instructions](../../AGENTS.md) first.

The tooling of the record imported with the mobile app: it renders the specs and plans under
`docs/mobile/superpowers/` to the HTML beside them, and audits that tree's instruction files,
skills and catalogue. It is not an npm workspace; it has its own lockfile.

```sh
npm ci --prefix scripts/mobile
npm run agents:check --prefix scripts/mobile   # instruction files, skills, manifest, generated views
npm run agents:test --prefix scripts/mobile
npm run docs:html --prefix scripts/mobile      # regenerate every view
npm run docs:check --prefix scripts/mobile     # fail on a stale or missing view
```

- `agents:check` audits only `apps/mobile/`, `docs/mobile/`, `services/reads/`, `infra/`,
  `scripts/mobile/`, `packages/mera-account/` and `packages/perpl-context/`, plus the skills in `.agents/skills/`. There,
  `AGENTS.md` is the real file, a `CLAUDE.md` is the one-line adapter `@AGENTS.md`, and the
  instruction chain inside that tree stays under 24 KiB (the repository root's own `AGENTS.md` is
  not counted). It does not judge the rest of
  the repository.
- The generated HTML embeds the generator's own path, so moving or renaming
  `docs-md-to-html.mjs` means regenerating every view in the same change.
- `agent-infra/check-changed-docs.mjs` and `agent-infra/render-check.mjs` are run from the
  repository root. [`agent-infra/README.md`](agent-infra/README.md) has the detail, in Spanish.
- The root's ESLint and Prettier do not apply here; keep the style the files have.
