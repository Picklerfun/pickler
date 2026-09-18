# Pickler (repo `predict`)

Monorepo del producto **Pickler**: launcher de agentes autónomos que operan prediction
markets. La app móvil vive en `apps/mobile` (Expo, npm; cómo correr y verificar en
[`apps/mobile/README.md`](apps/mobile/README.md), con su propio `AGENTS.md`). La raíz
sólo trae el tooling de documentación y agentes: `npm run agents:check`,
`agents:test`, `agents:inventory`, `docs:html`, `docs:check`. Sin workspaces:
`apps/mobile` se instala y ejecuta dentro de su carpeta, nunca desde raíz.

## Reglas del repo

- Español. Worktree por tarea en `.claude/worktrees/<tarea>`; anunciar rama y ruta
  antes de editar. Commits por nombre de archivo, nunca `git add -A`.
- Sin push, merge a `main` ni build/subida a TestFlight sin autorización explícita.
  Una autorización previa sigue vigente; no volver a pedirla.
- Documentación (specs, planes, overviews, audits, manifest): contrato en
  [`docs/CLAUDE.md`](docs/CLAUDE.md). Leerlo antes de escribir bajo `docs/`.
- Estado del producto: [`docs/04-roadmap-bounty.md`](docs/04-roadmap-bounty.md)
  (fases del bounty) y el catálogo `docs/overview/index.html` (`data/manifest.js`).
  Contexto fundacional en [`docs/00-historia.md`](docs/00-historia.md).
- **Deadline del bounty: 13 oct 2026, 21:59 CST.** Toda decisión de alcance se mide
  contra esa fecha.

`CLAUDE.md` es el archivo real y `AGENTS.md` su symlink hermano (`agents:check` lo
valida y mide la cadena ≤ 24 KiB). Excepción: en `apps/mobile` el real es `AGENTS.md`.
