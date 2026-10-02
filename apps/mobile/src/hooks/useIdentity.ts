import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountState, accountAddress } from "../account";
import { API_URL } from "../config/api";
import { CHAIN } from "../config/chain";
import { createProfile, describeIdentityError, fetchProfile, handleAvailable } from "../identity/api";
import { normalizeHandle } from "../identity/handle";
import { type IdentitySession, sessionFor, signInWithWallet } from "../identity/session";
import { type Identity, identityFor } from "../identity/state";
import { isStaleAccount } from "../reads/session";
import { loadIdentity, saveIdentity } from "../storage/identity";
import type { Wallet } from "../wallet/wallet";
import { useUnlock } from "./useUnlock";

export type IdentityApi = {
  identity: Identity;
  /** Una reclamación o una comprobación en curso. */
  busy: boolean;
  /** Lo que falló al reclamar o al volver a comprobar, en palabras para la pantalla. */
  error: string | null;
  /** ¿Está libre? true / false / null si no se pudo consultar. */
  check: (handle: string) => Promise<boolean | null>;
  claim: (handle: string) => Promise<void>;
  /** Vuelve a preguntar al servidor: quien vinculó esta wallet a su cuenta en la web ya tiene username. */
  recheck: () => Promise<void>;
};

const OFF: Identity = { status: "off" };
const UNKNOWN: Identity = { status: "unknown" };

/**
 * La cuenta de la wallet en la API del producto: la misma que en la web, porque el passkey y la derivación son los mismos.
 *
 * Con la wallet desbloqueada entra sola (firmar el mensaje no pide Face ID: la llave ya está abierta) y lee si la cuenta
 * tiene username. Lo guarda con su dirección, así que en el siguiente arranque no pregunta ni desbloquea nada. Sólo una
 * respuesta del servidor que dice «sin username» abre la pantalla obligatoria; un fallo de red no retiene a nadie.
 */
export function useIdentity(account: AccountState, onUnlock: (w: Wallet) => void): IdentityApi {
  const [identity, setIdentity] = useState<Identity>(API_URL === null ? OFF : UNKNOWN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = useUnlock(account, onUnlock);
  const address = accountAddress(account);
  const addressRef = useRef(address);
  addressRef.current = address;
  // El token vive en memoria: se vuelve a pedir firmando, que con la wallet abierta no cuesta nada.
  const session = useRef<IdentitySession | undefined>(undefined);
  // La dirección de la que habla `identity`: lo sabido de una cuenta no se arrastra a otra.
  const knownFor = useRef<string | null>(null);
  const wallet = account.status === "unlocked" ? account.wallet : null;

  /** Sesión vigente de esta wallet, o una nueva. */
  const ensureSession = useCallback(async (w: Wallet): Promise<IdentitySession> => {
    const current = sessionFor(session.current, w.address);
    if (current) return current;
    const fresh = await signInWithWallet({ base: API_URL!, address: w.address, chainId: CHAIN.id, sign: (message) => w.account.signMessage({ message }) });
    session.current = fresh;
    return fresh;
  }, []);

  /** Pregunta al servidor por el username de esta wallet y deja el estado que corresponde. */
  const resolve = useCallback(async (w: Wallet, stale: () => boolean) => {
    try {
      const profile = await fetchProfile(API_URL!, (await ensureSession(w)).token);
      if (stale()) return;
      if (profile) {
        await saveIdentity({ address: w.address, handle: profile.handle });
        if (!stale()) setIdentity({ status: "has", handle: profile.handle });
      } else {
        setIdentity({ status: "none" });
      }
    } catch {
      // No se pudo saber. No es «sin username»: nadie queda retenido por la red.
      if (!stale()) setIdentity({ status: "unreachable" });
    }
  }, [ensureSession]);

  // Cada vez que cambia la cuenta o se desbloquea: primero lo guardado (sin red ni Face ID), luego el servidor.
  useEffect(() => {
    if (API_URL === null) return;
    let cancelled = false;
    const stale = () => cancelled || isStaleAccount(address, addressRef.current);
    setError(null);
    if (knownFor.current !== address) {
      knownFor.current = address;
      session.current = undefined;
      setIdentity(UNKNOWN);
    }
    if (address === null) return;
    void (async () => {
      const stored = identityFor(await loadIdentity(), address);
      if (stale()) return;
      if (stored) { setIdentity({ status: "has", handle: stored.handle }); return; }
      // Bloqueada: no se pregunta (pediría Face ID). Lo que ya se sabía de esta dirección —incluido «sin username»— se queda.
      if (!wallet) return;
      setIdentity((cur) => (cur.status === "none" || cur.status === "has" ? cur : { status: "checking" }));
      await resolve(wallet, stale);
    })();
    return () => { cancelled = true; };
  }, [address, wallet, resolve]);

  const check = useCallback(async (handle: string) => (API_URL === null ? null : handleAvailable(API_URL, normalizeHandle(handle))), []);

  const claim = useCallback(async (raw: string) => {
    if (API_URL === null) return;
    const requested = addressRef.current;
    const stale = () => isStaleAccount(requested, addressRef.current);
    setBusy(true);
    setError(null);
    try {
      // Si la wallet se bloqueó con la pantalla abierta, desbloquear pide Face ID; es la única vez que esto lo pide.
      const w = await unlock();
      const handle = normalizeHandle(raw);
      const claimed = await createProfile(API_URL, (await ensureSession(w)).token, handle);
      if (stale()) return;
      await saveIdentity({ address: w.address, handle: claimed.handle });
      if (!stale()) setIdentity({ status: "has", handle: claimed.handle });
    } catch (e) {
      if (!stale()) setError(describeIdentityError(e));
    } finally {
      setBusy(false);
    }
  }, [ensureSession, unlock]);

  const recheck = useCallback(async () => {
    if (API_URL === null) return;
    const requested = addressRef.current;
    const stale = () => isStaleAccount(requested, addressRef.current);
    setBusy(true);
    setError(null);
    try {
      const w = await unlock();
      // La cuenta pudo cambiar en el servidor (se vinculó a otra): la sesión guardada es de la cuenta anterior.
      session.current = undefined;
      const profile = await fetchProfile(API_URL, (await ensureSession(w)).token);
      if (stale()) return;
      if (profile) {
        await saveIdentity({ address: w.address, handle: profile.handle });
        if (!stale()) setIdentity({ status: "has", handle: profile.handle });
      } else {
        setError("This wallet's account still has no username.");
      }
    } catch (e) {
      if (!stale()) setError(describeIdentityError(e));
    } finally {
      setBusy(false);
    }
  }, [ensureSession, unlock]);

  return { identity, busy, error, check, claim, recheck };
}
