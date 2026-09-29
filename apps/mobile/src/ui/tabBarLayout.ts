// Geometría de la tab bar del Handoff (spec mobile-light D2). Puro, para testearlo.
// La fila mide ROW_TOP + ROW_H y se apoya sobre insetBottom + ROW_BOTTOM.
export const ROW_TOP = 8;
/** 10 + icono 19 + gap 5 + etiqueta ~10 + 10. */
export const ROW_H = 54;
export const ROW_BOTTOM = 8;

/** Alto total de la barra (paddingBottom de las raíces y translateY al esconderla). */
export function tabBarHeight(insetBottom: number): number {
  return ROW_TOP + ROW_H + insetBottom + ROW_BOTTOM;
}
