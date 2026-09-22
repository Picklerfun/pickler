// Geometría de la tab bar (spec mobile-nav D11/D13). Puro: sin react-native, para poder testearlo.
// `'worklet'` en las funciones que TabBar llama desde los callbacks del Pan (hilo UI de reanimated); sin la
// directiva, worklets lanza "Tried to synchronously call a Remote Function". En Jest/Node la directiva es inerte.
// La fila mide `ROW_TOP + ROW_H` y se apoya sobre `insetBottom + ROW_BOTTOM`; los ítems reparten el ancho menos
// `ROW_PAD_X` a cada lado; la pastilla vive dentro de su ítem con `PILL_INSET` a cada lado.

export const TAB_COUNT = 5;
export const ROW_PAD_X = 6;
export const PILL_INSET = 2;
export const ROW_TOP = 8;
/** Alto de la fila de ítems: 6 + icono 19 + gap 5 + etiqueta 9 + 6 (los mismos valores que pinta TabBar). */
export const ROW_H = 45;
export const ROW_BOTTOM = 12;

export function itemWidth(rowWidth: number, count = TAB_COUNT): number {
  "worklet";
  return (rowWidth - 2 * ROW_PAD_X) / count;
}

/** Índice del ítem bajo la x del dedo, acotado a [0, count). */
export function tabIndexAt(x: number, rowWidth: number, count = TAB_COUNT): number {
  "worklet";
  const i = Math.floor((x - ROW_PAD_X) / itemWidth(rowWidth, count));
  return Math.min(count - 1, Math.max(0, i));
}

export function pillX(index: number, rowWidth: number, count = TAB_COUNT): number {
  "worklet";
  return ROW_PAD_X + index * itemWidth(rowWidth, count) + PILL_INSET;
}

export function pillWidth(rowWidth: number, count = TAB_COUNT): number {
  return itemWidth(rowWidth, count) - 2 * PILL_INSET;
}

/** Alto total de la barra (para el `paddingBottom` de las páginas raíz y para esconderla con translateY). */
export function tabBarHeight(insetBottom: number): number {
  return ROW_TOP + ROW_H + insetBottom + ROW_BOTTOM;
}
