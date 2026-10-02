// Historial de marks por mercado para la sparkline de la matriz (F2-matrix). Puro.
// Perpl pub/context no da historial: la app guarda los últimos SPARK_POINTS marks que recibe
// (uno por refreshContext, cada CONTEXT_POLL_MS mientras la pestaña está activa). En memoria, sin persistir.

export const SPARK_POINTS = 60;
export type MarkHistory = Readonly<Record<number, readonly number[]>>;

/** Añade el mark actual de cada mercado y recorta al máximo. No muta la entrada. */
export function appendMarks(history: MarkHistory, markets: readonly { id: number; mark: number }[], max = SPARK_POINTS): MarkHistory {
  const next: Record<number, readonly number[]> = { ...history };
  for (const m of markets) {
    const prev = next[m.id] ?? [];
    next[m.id] = prev.length >= max ? [...prev.slice(prev.length - max + 1), m.mark] : [...prev, m.mark];
  }
  return next;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const SPARK_PAD = 6;

/** Puntos de la polilínea en un viewBox 0..100: x por índice, y invertida (6 = máximo, 94 = mínimo; margen para que el trazo no muera bajo la hairline de la card). Con < 2 puntos o todos iguales, línea plana a media altura. */
export function sparkPoints(marks: readonly number[]): [number, number][] {
  if (marks.length < 2) return [[0, 50], [100, 50]];
  const min = Math.min(...marks);
  const max = Math.max(...marks);
  const span = max - min;
  const last = marks.length - 1;
  return marks.map((v, i) => [round1((i / last) * 100), span === 0 ? 50 : round1(SPARK_PAD + (100 - 2 * SPARK_PAD) * (1 - (v - min) / span))]);
}
