---
name: pickler-retomar
description: "Use when the user resumes work on Pickler after clearing context or starting a fresh session and needs to know where things stand. Triggers on \"retomar\", \"/retomar\", \"¿en qué íbamos?\", \"dónde quedamos\", \"qué tengo pendiente\", \"sigamos con X\", \"continuamos\", \"¿cómo va el build de TestFlight?\". Reads the manifest, every git branch (not just worktrees), the audits, the bounty deadline, the latest TestFlight tracker and the testnet accounts, and reports the COMPLETE inventory of unfinished work plus each project's next step."
---

# Retomar · Pickler

## Elegir el alcance de lectura

Si pide inventario general, reportar todo lo abierto con el flujo de abajo. Si ya
identificó un proyecto («sigamos con Perpl»), leer manifest/plan/audit de X y comprobar
conflictos de Git; continuar el alcance autorizado sin volcar todos los proyectos ni pedir
que vuelva a elegir. El inventario completo aplica al primer modo; no obliga a frenar una
tarea elegida.

El usuario limpió el contexto o abrió una sesión nueva. **Nada de lo que importa vive en el
chat** — vive en `docs/mobile/overview/data/manifest.js`, en los specs, en los audits y en git.
Reconstruyes el estado desde ahí, sin memoria del asistente ni rutas fuera del repo: todo lo
que esta skill lee está en el checkout o en `git`.

**Esto es un inventario, no un resumen.** El usuario invoca esta skill justamente porque no
recuerda qué tiene abierto; una selección de "lo más relevante" le esconde trabajo que no puede
recuperar de memoria. El inventario completo cabe de sobra (hoy el manifest tiene unas pocas
entradas) y es barato. La compresión viene después, cuando él elija — no antes.

**No leas specs completos todavía.** Primero el mapa; el detalle sólo del que elija.

## 1. El mapa: todo lo que el manifest sabe

El `status` global de cada entrada se actualiza a mano y **puede mentir en las dos
direcciones**: `active` con todas sus fases `completed`, o —peor— `completed` con fases
`pending`. Por eso **el `status` global no filtra nada**: sólo se reporta como discrepancia.
La fuente de verdad son las **fases**.

```bash
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd .
node -e "
global.window={};
require('./docs/overview/data/manifest.js');
const abiertaF = p => p.status !== 'completed' && p.status !== 'cancelled';
const cerradoS = s => s === 'completed' || s === 'shipped';
const descartado = d => d.status === 'cancelled';   // no se va a hacer: fases pendientes son consistentes
const vivos = [], sinFases = [], porCerrar = [], muertos = [];
for (const d of window.DOCS) {
  if (descartado(d)) { muertos.push(d); continue; }
  const ph = d.phases || [];
  if (ph.length === 0) { if (!cerradoS(d.status)) sinFases.push(d); continue; }
  if (ph.some(abiertaF)) vivos.push(d);
  else if (!cerradoS(d.status)) porCerrar.push(d);
}
console.log('EN VUELO (' + vivos.length + ') — tienen al menos una fase abierta');
for (const d of vivos) {
  const sig = d.phases.find(abiertaF);
  const alerta = cerradoS(d.status) ? '  [!] status global dice ' + d.status : '';
  console.log(' · ' + d.title + alerta);
  console.log('     ' + d.phases.map(p => 'F'+p.num+':'+p.status).join(' '));
  console.log('     siguiente: F' + sig.num + ' (' + sig.status + ')  ·  docs/mobile/overview/' + d.file);
}
console.log('');
console.log('SIN FASES DECLARADAS (' + sinFases.length + ') — one-pagers dev; su estado no se deduce del manifest');
for (const d of sinFases) console.log(' · [' + d.status + '] ' + d.title + '  ·  docs/mobile/overview/' + d.file);
console.log('');
console.log('TERMINADOS SIN CERRAR (' + porCerrar.length + ') — todas las fases completed, status sin actualizar:');
console.log('  ' + porCerrar.map(d => d.title).join(' · '));
console.log('');
console.log('DESCARTADOS (' + muertos.length + ') — status cancelled; no son trabajo pendiente aunque tengan fases pending:');
for (const d of muertos) console.log('  · ' + d.title + (d.supersededBy ? '  → ' + d.supersededBy : ''));
"
```

Los **en vuelo** van completos al reporte. Las entradas **sin `phases` son dev trackers**
(builds de TestFlight, fixes, PRs): su estado es su `status` y van en su propia tabla,
**incluidos los `shipped`**: el último build distribuido es parte del estado.

```bash
node -e "global.window={};require('./docs/overview/data/manifest.js');for(const d of window.DOCS.filter(d=>!d.phases))console.log(d.date,d.status.padEnd(9),d.title,' · docs/mobile/overview/'+d.file)"
```

Los *terminados sin cerrar* van en una línea al final: son limpieza de manifest, no trabajo.

**`cancelled` sí cierra el caso, y `completed` no.** `completed` *afirma que el trabajo se
hizo*: una fase `pending` lo desmiente y se reporta la discrepancia. `cancelled` afirma que
**no se va a hacer**: sus fases `pending` son verdad histórica, y es el único status que saca
una entrada del inventario. Igual por fase: una `cancelled` no es trabajo pendiente (`abiertaF`
la excluye); marcarla `completed` para que el proyecto "cierre" es la mentira que esta skill
persigue.

Si el manifest no carga, dilo y sigue con el paso 2 — git no miente aunque el manifest esté roto.

**El manifest sólo ve la rama en la que estás.** Un proyecto cuya entrada vive en una rama sin
mergear no aparece aquí. Por eso el paso 2 no es opcional, y por eso no basta con mirar worktrees.

## 2. El trabajo que sólo existe en git

Un worktree es apenas una de las cinco formas en que el trabajo se queda fuera de `origin/main`
(ramas locales sin worktree, remotas, worktrees fuera de `.claude/`, cambios sin commit,
stashes). Desde la raíz del checkout:

```bash
node scripts/mobile/agent-infra/branches.mjs origin/main
```

Imprime JSON: `branches` (locales y remotas, con `status`, `headSha`,
`commitsOutsideBaseline`), `worktrees` (todos los registrados, con `changes` sin commit) y
`stashes`. Declara refs locales (`remoteFreshness`): no afirma frescura remota. Si falta
`origin/main`, informa el error y elige una base existente; un error no es inventario vacío.

- `integrated_ancestry`: el HEAD medido es ancestro de la base. No prueba deploy ni build.
  Es el caso de las cuatro `feat/mobile-*` (build3, perpl, ui-port, wallet): mergeadas y
  pusheadas, con worktrees aún registrados.
- `patch_equivalent_review`: todos los commits comparables tienen parche equivalente;
  revisar merges, reversiones y estado final antes de concluir.
- `unknown_review`: no hay prueba suficiente. Puede estar squash-mergeada, haber sido
  reemplazada o seguir pendiente. **Nunca etiquetar como «perdido» o «ya integrado» por
  contar archivos distintos; incluye documentación.**

Para resolver un squash, consulta PRs y comprueba que su `headRefOid` coincide con el SHA
inventariado y que el merge pertenece a la base examinada; un PR del mismo nombre de rama
con otro HEAD no basta. Reporta por separado integración, trabajo posterior y build.

Consulta PRs con `gh pr list --state open --limit 100 --json number,title,headRefName,headRefOid`;
si hay 100 resultados, pagina antes de afirmar que el inventario está completo. Sin gh o
sin acceso, declara esa parte no verificada y sigue con la evidencia local.
No borres ramas, stashes o worktrees durante un inventario; una recomendación de limpieza
exige revalidar SHA, cambios ignorados y sesiones vivas.

## 3. Las decisiones que no están en los commits

```bash
ls docs/mobile/superpowers/audits/*.md 2>/dev/null | sort -r | head -5
```

Los audits (`<fecha>-<topic>-f<N>-rulings.md`, uno por fase ejecutada) guardan lo que se
decidió **sin el usuario**, las correcciones a afirmaciones previas y los residuales abiertos.
Un commit message no alcanza para eso. Si el proyecto que va a retomar tiene audit, léelo
**antes** de proponer nada — ahí están las trampas ya pisadas.

## 4. Reporta así

**En tablas.** Una lista de bullets separada por `·` es un párrafo apelmazado que el usuario
no puede escanear; entonces da igual que esté completa.

Tres tablas. Primero lo que se puede perder, porque es lo único urgente:

```
| Dónde | Qué es | Commits |
|---|---|---|
| origin/<rama-sin-mergear> | <el fix o feature> | N · M archivos |
| main local | sin push | N |
| worktree <nombre> | <proyecto> · <status de branches.mjs> | N · cambios sin commit |
| <rama local sin worktree> | <qué es> | N |
```

Luego los proyectos con fases, **ordenados por fases restantes ascendente** — arriba quedan
los que están a una fase de cerrarse, que casi siempre es lo que conviene tocar:

```
| Proyecto | Avance | Siguiente | Falta |
|---|---|---|---|
| <título> | 1/1 | — | 0 |
```

Y los dev trackers, del más reciente al más antiguo:

```
| Fecha | Status | Tracker |
|---|---|---|
| 2026-09-17 | pending | TestFlight build 4 |
| 2026-09-16 | shipped | TestFlight build 3 |
```

Genéralas con node desde el manifest, no a mano. Marca con `[!]` la fila cuyo `status`
global contradiga a sus fases. Después, en una línea cada uno: los terminados sin cerrar, el deadline, el bloque de
cuentas (4b) y el residual más pesado del audit más reciente (sección "Residuales" o
"Pendientes", según su formato).

Si no eligió proyecto, termina con «¿con cuál sigues?». Si ya dijo «sigamos con X», continúa
con X dentro del alcance autorizado; no hagas la pregunta ni vuelvas a pedir esa elección.

## 4b. Lo que sólo Pickler pierde entre sesiones

Tres cosas que no están en git: cuánto falta para el bounty, qué build está en TestFlight y
cómo quedaron las cuentas.

```bash
# Deadline del bounty (docs/mobile/04-roadmap-bounty.md §1): 13 oct 2026 21:59 CST
node -e "const d=(new Date('2026-10-13T21:59:00-06:00')-Date.now())/864e5;console.log('Bounty: faltan '+Math.floor(d)+' días')"
# Build de TestFlight: el tracker testflight-* más reciente del manifest (no el contador del index, que cuenta pending)
node -e "global.window={};require('./docs/overview/data/manifest.js');const t=window.DOCS.filter(d=>/testflight/.test(d.file)).sort((a,b)=>b.date.localeCompare(a.date));for(const d of t)console.log(d.date,d.status.padEnd(9),d.title)"
# Cuentas de testnet: el audit más reciente con esa sección (sólo la sección)
node -e "const fs=require('fs');const d='docs/mobile/superpowers/audits/';const f=fs.readdirSync(d).filter(n=>n.endsWith('.md')&&fs.readFileSync(d+n,'utf8').includes('## Estado de las cuentas')).sort().pop();if(!f){console.log('(ningún audit con sección de cuentas)');process.exit()}const s=fs.readFileSync(d+f,'utf8');const m=s.match(/## Estado de las cuentas[^\n]*\n[\s\S]*?(?=\n## |$)/);console.log(f);console.log(m?m[0]:'(sección no encontrada)')"
```

Reglas de lectura:

- El `date` del manifest es **fecha de registro, no de trabajo**: el tracker del build 4 dice
  `2026-09-17` porque el spec fijó esa fecha, no porque se haya trabajado ese día. La fecha de
  la sesión real está en el audit.
- `shipped` con `VALID` en App Store Connect **no prueba distribución**: el build puede estar
  procesado y sin grupo de testers. Lee el tracker y el audit; no infieras ni subas nada.
- Las cuentas del audit son **"al cierre de esa sesión"**, no verdad viva: saldos de AUSD/MON,
  IDs de cuenta de Perpl y forwarding pudieron cambiar desde otro dispositivo. Antes de operar,
  re-mide con RPC (balances, `readAccountId`) y reporta la diferencia.
- `docs/mobile/00–04*.md` son **producto y decisiones**, no estado de ejecución. El estado vivo está en
  el manifest, los trackers de `docs/mobile/overview/dev/` y los audits.
- "En implementación" en `docs/mobile/overview/index.html` cuenta `active` + `in_progress` +
  `pending`: un tracker propuesto y sin decidir suma igual que uno a medias. No lo leas como
  trabajo en curso.
- Para contar fases en un overview usa `grep -c '^ *<article class="phase-card"'`: el script
  del template repite la cadena en literales y un `grep` a secas da 3 donde hay 1.
- El proyecto que construye el catálogo (spec `docs-manifest`) también tiene entrada y overview;
  si una rama con commits `unknown_review` no aparece en el manifest, busca su spec en
  `docs/mobile/superpowers/specs/` y su plan más reciente en `docs/mobile/superpowers/plans/` antes de
  llamarla caja negra.

## 5. Cuando ya eligió

Sólo entonces:

1. Lee `docs/mobile/superpowers/specs/<fecha>-<topic>-design.md` — las decisiones numeradas (D1, D2…)
   son el contrato; el plan (`docs/mobile/superpowers/plans/<fecha>-<topic>[-fN].md`) argumenta desde ahí.
2. Lee el audit del proyecto si existe.
3. Abre `docs/mobile/overview/<fecha>-<topic>.html` sólo si necesitas el detalle de una fase.
4. **Vuelve a medir contra la base viva** cualquier número que vayas a usar. Specs y audits
   fechan sus mediciones a propósito: punto de partida, no verdad vigente. El caso que lo
   motivó: el `3401` que Perpl devolvió dos veces en un iPhone real se reportó como
   geobloqueo; la causa era el **reloj del teléfono desfasado** (firmas fuera de ±30 s).

## Anti-patterns

- ❌ Entregar una selección de "los que importan". El usuario no puede echar de menos lo que no
  recuerda; omitir es esconder. Lista todo.
- ❌ Mirar sólo `.claude/worktrees/`. Hay trabajo en ramas locales sin worktree y en ramas
  remotas que ningún directorio recuerda.
- ❌ Reportar como «trabajo perdido» una rama que `--no-merged` lista sin comprobar su
  contenido contra `main`. Los squash-merges la dejan ahí de por vida.
- ❌ Filtrar por el `status` global del manifest. Miente en ambas direcciones; sólo se reporta
  como discrepancia contra las fases.
- ❌ Leer los specs de todos los proyectos "para tener contexto". Es justo lo que vuelve a
  llenar el contexto que el usuario acaba de limpiar.
- ❌ Dar por bueno un número del spec o del audit sin re-medirlo. Están fechados por algo.
- ❌ Deducir el build vivo del contador del index o de un `VALID`; el tracker y el audit dicen
  qué se distribuyó.
- ❌ Implementar fuera del alcance aprobado. Una elección explícita de proyecto ya es una
  elección; no la preguntes otra vez.
