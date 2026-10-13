"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  perplDashboardMarketsSchema,
  perplPortfolioSchema,
  type PerplDashboardMarketsDto,
  type PerplPortfolioDto,
} from "@pickler/api-schema";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import { walletFailure } from "@/features/wallet/lib/wallet-request-error";
import { authorizeReadAccess, clearReadAccess, readAccess } from "./access";
import { PerplReadError, perplRequest } from "./client";
type Stage = "idle" | "preparing" | "signing" | "authorizing";
export function usePerplDashboard() {
  const wallet = useWallet();
  const scope = wallet.address
    ? `${wallet.kind}:${wallet.providerId ?? "mera"}:${wallet.address.toLowerCase()}`
    : "";
  const current = useRef(scope);
  const flight = useRef<AbortController | null>(null);
  const [market, setMarket] = useState<PerplDashboardMarketsDto | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<{ scope: string; data: PerplPortfolioDto } | null>(
    null,
  );
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [stage, setStage] = useState<{ scope: string; value: Stage }>({ scope: "", value: "idle" });
  const [authorized, setAuthorized] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const run = async () => {
      if (disposed || document.hidden) {
        return;
      }
      controller = new AbortController();
      try {
        const data = await perplRequest("markets", perplDashboardMarketsSchema, controller.signal);
        if (!disposed) {
          setMarket(data);
          setMarketError(null);
          setNow(Date.now());
        }
      } catch (e) {
        if (!disposed && !controller.signal.aborted) {
          setMarketError(
            e instanceof PerplReadError
              ? e.message
              : "Perpl is not responding. Updates will retry shortly.",
          );
        }
      } finally {
        if (!disposed && !document.hidden) {
          timer = setTimeout(run, 10_000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) {
        void run();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void run();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    current.current = scope;
    flight.current?.abort();
    flight.current = null;
    const access = readAccess(scope);
    if (access) {
      void Promise.resolve().then(() => {
        if (current.current === scope) {
          setAuthorized(scope);
        }
      });
    } else {
      clearReadAccess();
    }
    return () => {
      flight.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    if (!scope || authorized !== scope) {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const run = async () => {
      if (disposed || document.hidden) {
        return;
      }
      const access = readAccess(scope);
      if (!access) {
        setAuthorized("");
        setError({ scope, message: "Read access expired. Authorize it again." });
        return;
      }
      controller = new AbortController();
      let delay = 5000;
      try {
        const proof = await access.proofs();
        controller.signal.throwIfAborted();
        const data = await perplRequest(
          "portfolio",
          perplPortfolioSchema,
          controller.signal,
          access.token,
          proof,
        );
        if (data.wallet.toLowerCase() !== wallet.address?.toLowerCase()) {
          throw new PerplReadError("INVALID_RESPONSE", "The snapshot belongs to another wallet.");
        }
        if (!disposed && current.current === scope) {
          setPortfolio({ scope, data });
          setError(null);
          setNow(Date.now());
        }
      } catch (e) {
        if (!disposed && !controller.signal.aborted && current.current === scope) {
          setError({
            scope,
            message:
              e instanceof PerplReadError
                ? e.message
                : "The account could not be read. Updates will retry shortly.",
          });
          if (
            e instanceof PerplReadError &&
            ["READ_ACCESS_EXPIRED", "READ_ACCESS_DENIED", "NO_PERPL_PROFILE"].includes(e.code)
          ) {
            clearReadAccess();
            setAuthorized("");
            return;
          }
          delay = 30_000;
        }
      } finally {
        if (!disposed && !document.hidden && readAccess(scope)) {
          timer = setTimeout(run, delay);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) {
        void run();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void run();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scope, authorized, wallet.address]);
  const authorize = useCallback(async () => {
    if (!scope || !wallet.address || flight.current) {
      return;
    }
    const controller = new AbortController();
    flight.current = controller;
    setError(null);
    setStage({ scope, value: "preparing" });
    try {
      const signedIn = await wallet.signInWithWallet(
        () => current.current === scope && !controller.signal.aborted,
      );
      if (!("token" in signedIn)) {
        throw new Error(signedIn.error ?? "Sign-in was cancelled.");
      }
      controller.signal.throwIfAborted();
      await authorizeReadAccess({
        scope,
        wallet: wallet.address,
        token: signedIn.token,
        signal: controller.signal,
        sign: wallet.signPerplReadKey,
        onStage: (value) => {
          if (current.current === scope) {
            setStage({ scope, value });
          }
        },
        now: Date.now(),
      });
      if (current.current === scope) {
        setAuthorized(scope);
      }
    } catch (e) {
      if (!controller.signal.aborted && current.current === scope) {
        setError({
          scope,
          message:
            e instanceof PerplReadError ? e.message : walletFailure(e, "eth_signTypedData_v4").hint,
        });
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null;
      }
      if (current.current === scope) {
        setStage({ scope, value: "idle" });
      }
    }
  }, [scope, wallet]);
  const data = portfolio?.scope === scope ? portfolio.data : null;
  return {
    wallet,
    market,
    marketError,
    portfolio: data,
    error: error?.scope === scope ? error.message : null,
    stage: stage.scope === scope ? stage.value : "idle",
    authorized: authorized === scope && scope !== "",
    authorize,
    now,
  };
}
