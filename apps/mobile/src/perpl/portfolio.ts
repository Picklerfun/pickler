/**
 * Bloque TOTAL de Portfolio (spec mobile-light D7). `b` = saldo de la cuenta de Perpl fuera de posiciones,
 * `lb` = parte de `b` bloqueada por órdenes (el ticket usa `b − lb` como libre), `locked` = colateral de
 * posiciones (`lockedCollateral`), `upnl` = PnL no realizado. El saldo de la wallet no entra: vive en Wallet.
 */
export function portfolioTotals({ b, lb, locked, upnl }: { b: bigint; lb: bigint; locked: bigint; upnl: bigint | null }) {
  const inOrders = lb < b ? lb : b;
  const available = b - inOrders;
  const positions = locked + (upnl ?? 0n);
  return { total: available + inOrders + positions, positions, available, inOrders };
}
