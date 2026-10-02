#!/usr/bin/env bash
#
# Corre un comando de tests tomando un lock GLOBAL, compartido por todos los
# checkouts de proflores (el principal y todos los worktrees).
#
# Por qué existe: el 2026-08-09 tres agentes en worktrees distintos corrieron sus
# suites a la vez y la máquina murió con kernel panic (63 procesos node, 55 GB
# residentes sobre 24 GB de RAM). El techo de workers por runner —maxWorkers en
# los configs— acota UNA corrida; este lock acota cuántas corren a la vez. Son
# defensas distintas: el techo hace que una corrida quepa, el lock hace que no se
# multipliquen.
#
# Uso (desde el script "test" de un workspace, cwd = el package):
#   bash ../../scripts/test-lock.sh jest
#   bash ../../scripts/test-lock.sh vitest run --minWorkers=1 --maxWorkers=3
#
# Escapes:
#   PROFLORES_TEST_LOCK=0        salta el lock por completo (corres tú solo y sabes
#                                que nadie más está probando)
#   PROFLORES_TEST_LOCK_TIMEOUT  segundos máximos de espera, default 1800 (30 min)
#
# Ver quién lo tiene:  readlink /tmp/proflores-test.lock
# Soltarlo a mano:     rm -f /tmp/proflores-test.lock
#
# Por qué un SYMLINK y no un directorio con un archivo adentro: `mkdir` es atómico,
# pero entre crearlo y escribir "quién soy" adentro hay una ventana en la que otro
# proceso ve un lock sin dueño, lo cree huérfano y lo roba — y los dos corren a la
# vez, que es justo lo que este script existe para impedir. No es teórico: pasó en
# la primera corrida de `turbo test` con dos workspaces. `ln -s` publica el lock y
# su dueño en la MISMA operación atómica, así que esa ventana no existe.
#
# macOS no trae `flock` y trae bash 3.2: nada de mapfile ni arrays asociativos.

set -uo pipefail

LOCK="/tmp/proflores-test.lock"
TIMEOUT="${PROFLORES_TEST_LOCK_TIMEOUT:-1800}"
POLL=5

if [ "$#" -eq 0 ]; then
  echo "test-lock: falta el comando a correr" >&2
  exit 64
fi

# --- Escape 1: apagado explícito ------------------------------------------------
if [ "${PROFLORES_TEST_LOCK:-1}" = "0" ]; then
  exec "$@"
fi

# --- Escape 2: reentrancia ------------------------------------------------------
# `turbo test` desde la raíz lanza el script `test` de cada workspace. Si algún día
# uno de esos scripts anida otro, el hijo heredaría esta env y pasaría de largo en
# vez de esperar a su propio padre hasta el timeout.
if [ "${PROFLORES_TEST_LOCK_HELD:-}" = "1" ]; then
  exec "$@"
fi

LABEL="${PWD##*/}"
# El payload viaja en el target del symlink: pid|label|epoch-de-creación.
PAYLOAD="$$|$LABEL|$(date +%s)"
HELD=0

# Soltar SOLO si el lock sigue siendo nuestro. Un `rm` a ciegas en el trap borraría
# el lock de otro proceso si salimos después de que alguien más lo tomó.
release() {
  if [ "$HELD" = "1" ]; then
    if [ "$(readlink "$LOCK" 2>/dev/null)" = "$PAYLOAD" ]; then
      rm -f "$LOCK"
    fi
  fi
}
trap release EXIT INT TERM

# `sysctl -n kern.boottime` imprime: { sec = 1786319105, usec = 349975 } Sun Aug ...
# El patrón va ANCLADO al inicio a propósito: con `.*sec = ` el `.*` es codicioso y
# se come hasta el segundo campo, devolviendo el `usec` (un número chico que hace
# que ningún lock parezca viejo y mata la detección de huérfanos por reinicio).
boot_epoch() {
  sysctl -n kern.boottime 2>/dev/null | sed -n 's/^{ *sec *= *\([0-9][0-9]*\).*/\1/p'
}

# Devuelve 0 si el lock está abandonado, con el motivo en STALE_REASON y el target
# exacto que se diagnosticó en STALE_TARGET (para no borrar a ciegas después).
STALE_REASON=""
STALE_TARGET=""
lock_is_stale() {
  local target lock_pid lock_epoch boot
  target=$(readlink "$LOCK" 2>/dev/null) || return 1
  [ -n "$target" ] || return 1
  STALE_TARGET="$target"

  lock_pid="${target%%|*}"
  lock_epoch="${target##*|}"

  case "$lock_pid" in
    ''|*[!0-9]*) STALE_REASON="su contenido no es legible ($target)"; return 0 ;;
  esac

  # Un lock creado antes del último arranque no puede ser de un proceso vivo: quedó
  # de una sesión que murió sin soltar nada. Exactamente lo que dejó el panic del
  # 2026-08-09. Se compara contra el epoch del propio payload, no contra el mtime
  # del symlink, porque el payload lo escribió su dueño y nadie más lo toca.
  boot=$(boot_epoch)
  case "$lock_epoch" in
    ''|*[!0-9]*) ;;
    *)
      if [ -n "$boot" ] && [ "$lock_epoch" -lt "$boot" ]; then
        STALE_REASON="es anterior al último arranque del sistema (sobrevivió a un reinicio)"
        return 0
      fi
      ;;
  esac

  kill -0 "$lock_pid" 2>/dev/null && return 1
  STALE_REASON="su proceso (PID $lock_pid) ya no existe"
  return 0
}

WAITED=0
NOTIFIED=0

while :; do
  if ln -s "$PAYLOAD" "$LOCK" 2>/dev/null; then
    HELD=1
    break
  fi

  # No entró. O hay alguien probando de verdad, o el lock quedó huérfano.
  if lock_is_stale; then
    echo "test-lock: lock huérfano — $STALE_REASON. Lo recupero."
    # Borrar por target: si entre el diagnóstico y el `rm` alguien legítimo tomó el
    # lock, este `rm` no debe tumbárselo.
    if [ "$(readlink "$LOCK" 2>/dev/null)" = "$STALE_TARGET" ]; then
      rm -f "$LOCK"
    fi
    continue
  fi

  if [ "$NOTIFIED" = "0" ]; then
    HOLDER=$(readlink "$LOCK" 2>/dev/null)
    HOLDER_LABEL=$(printf '%s' "$HOLDER" | cut -d'|' -f2)
    HOLDER_EPOCH=$(printf '%s' "$HOLDER" | cut -d'|' -f3)
    HOLDER_SINCE=$(date -r "$HOLDER_EPOCH" '+%H:%M:%S' 2>/dev/null)
    echo "test-lock: esperando — '${HOLDER_LABEL:-?}' está corriendo tests desde ${HOLDER_SINCE:-?}."
    echo "           (para saltártelo: PROFLORES_TEST_LOCK=0 pnpm ...)"
    NOTIFIED=1
  fi

  if [ "$WAITED" -ge "$TIMEOUT" ]; then
    echo "test-lock: seguí esperando ${TIMEOUT}s y el lock no se soltó." >&2
    echo "           Quién lo tiene: $(readlink "$LOCK" 2>/dev/null)" >&2
    echo "           Si sobró de una sesión muerta: rm -f $LOCK" >&2
    exit 75
  fi

  sleep "$POLL"
  WAITED=$((WAITED + POLL))
done

if [ "$NOTIFIED" = "1" ]; then
  echo "test-lock: lock libre tras ${WAITED}s — arranco."
fi

PROFLORES_TEST_LOCK_HELD=1 "$@"
STATUS=$?

# `release` corre en el trap de EXIT. Propagamos el status real de los tests: sin
# esto, el exit code del script sería el del último comando interno y una suite
# roja pasaría por verde.
exit $STATUS
