# Infraestructura de agentes

Validación local sin servicios de negocio (Node + Python 3 estándar):

```bash
npm run agents:check --prefix scripts/mobile
npm run agents:test --prefix scripts/mobile
node scripts/mobile/agent-infra/check-changed-docs.mjs
npm run agents:inventory --prefix scripts/mobile
```

`agents:check` valida frontmatter YAML real, referencias Markdown declaradas en skills,
pares CLAUDE/AGENTS, cadenas de 24 KiB, targets del manifest, fases comparables y
existencia del HTML vecino de specs/planes. Excluye `plans/data/`: son datos auxiliares,
no planes. No demuestra veracidad del contenido, disponibilidad de producción ni frescura
remota de Git. Los dashboards sin phase-cards necesitan revisión humana de su estado.

`behavior-cases.json` registra casos semánticos de routing de las skills `pickler-*`; se
revisan a mano, no son una evaluación automática.

`check-changed-docs` compara contenido generado de los Markdown cambiados; en CI usa
`DOCS_BASE_SHA` del evento. Localmente incluye modificados/no trackeados. Comprueba
históricos explícitamente con `node scripts/mobile/docs-md-to-html.mjs --all --check`; no se
regeneran todas las vistas históricas incidentalmente. `--missing` repone solo ausentes.

Los tests usan fixtures temporales y lock global. Incluyen los defectos reales de YAML,
ramas docs-only/squash, HTML obsoleto y límites. No son una evaluación automática de
obediencia de modelos. `test-lock.sh` comparte el lock
`/tmp/proflores-test.lock` con Proflores a propósito: el límite es la máquina, no el repo.

## Navegador y CI

```bash
node scripts/mobile/agent-infra/render-check.mjs /tmp/pickler-agent-render
```

`render-check` usa `puppeteer-core` con el Chrome local ya instalado (override con
`PICKLER_CHROME`); sin argumento renderiza `index` más todos los overviews del manifest.
Genera capturas y JSON en 1440/390 px. Puede requerir permiso del sandbox. Abrir las
capturas antes de afirmar calidad visual. No inicia servidores del negocio.
