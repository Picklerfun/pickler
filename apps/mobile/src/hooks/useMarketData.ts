import { useEffect, useState } from "react";
import { PERPL_URLS } from "../config/perpl";
import { type Book, MarketDataSocket } from "../perpl/marketData";
import type { SocketStatus } from "../perpl/ws";

export type MarketData = {
  /** `idle` = sin socket (Trade no visible o sin key); el resto es el estado del socket. */
  status: SocketStatus | "idle";
  /** null hasta el primer snapshot; tras una caída conserva el último libro hasta el snapshot nuevo. */
  book: Book | null;
  /** El stream fue rechazado (404/429): no se reintenta (P6). */
  rejected: boolean;
};

const IDLE: MarketData = { status: "idle", book: null, rejected: false };

/** Order book del mercado visible en Trade (D11, P5): un socket por ticket, abierto sólo con `active`; cambiar de mercado lo recrea. */
export function useMarketData(marketId: number | undefined, active: boolean): MarketData {
  const [data, setData] = useState<MarketData>(IDLE);
  useEffect(() => {
    if (!active || marketId === undefined) { setData(IDLE); return; }
    const socket = new MarketDataSocket({
      url: PERPL_URLS.marketData, marketId,
      onEvent: (e) => setData((d) => e.type === "status" ? { ...d, status: e.status } : e.type === "book" ? { ...d, book: e.book } : { ...d, rejected: true }),
    });
    setData({ status: "connecting", book: null, rejected: false });
    socket.connect();
    return () => { socket.close(); };
  }, [marketId, active]);
  return data;
}
