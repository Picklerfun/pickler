// Rango de marcas combinantes U+0300–U+036F: \p{Diacritic} no es fiable en Hermes.
const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Buscador local de Markets (spec mobile-light D9): símbolo o nombre, sin distinguir mayúsculas ni acentos. */
export function filterMarkets<M extends { symbol: string; name: string }>(markets: readonly M[], query: string): M[] {
  const q = fold(query);
  return q === "" ? [...markets] : markets.filter((m) => fold(m.symbol).includes(q) || fold(m.name).includes(q));
}
