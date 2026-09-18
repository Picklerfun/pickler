/** Swipe desde el borde izquierdo = atrás (D7). Puro: sin react-native para poder testearlo. */
export const EDGE_PX = 24;
export const BACK_DX = 60;
/** Mínimo de dx antes de capturar: evita robarle el tap a los Pressable por 1-2px de jitter. */
export const SLOP_PX = 8;

export function shouldCaptureEdgeSwipe(x0: number, dx: number, dy: number): boolean {
  return x0 <= EDGE_PX && dx >= SLOP_PX && dx > Math.abs(dy);
}

export function shouldGoBack(dx: number): boolean {
  return dx > BACK_DX;
}
