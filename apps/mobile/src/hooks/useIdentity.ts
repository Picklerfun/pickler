import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountState, accountAddress } from "../account";
import { API_URL } from "../config/api";
import { CHAIN } from "../config/chain";
import { createProfile, describeIdentityError, fetchProfile, handleAvailable, isHandleRefusal } from "../identity/api";
import { normalizeHandle } from "../identity/handle";
import { type IdentitySession, sessionFor, signInWithWallet } from "../identity/session";
import { type Identity, identityFor } from "../identity/state";
import { isStaleAccount } from "../reads/session";
import { loadIdentity, saveIdentity } from "../storage/identity";
import { describeError, type Wallet } from "../wallet/wallet";
import { useUnlock } from "./useUnlock";

export type IdentityApi = {
  identity: Identity;
  /** Una reclamación o una comprobación en curso. */
  busy: boolean;
  /** Lo que falló al reclamar o al volver a comprobar, en palabras para la pantalla. */
  error: string | null;
  clearError: () => void;
  /** ¿Está libre? true / false / null si no se pudo consultar. */
  check: (handle: string) => Promise<boolean | null>;
  claim: (handle: string) => Promise<void>;
  /**
   * Vuelve a preguntar al servidor: quien vinculó esta wallet a su cuenta en la web ya tiene username. `quiet`: sin
   * mensaje si sigue sin tenerlo (la comprobación que la app hace sola al volver del navegador).
   */
  recheck: (opts?: { quiet?: boolean }) => Promise<void>;
};

const OFF: Identity = { status: "off" };
const UNKNOWN: Identity = { status: "unknown" };

/**
 * La cuenta de la wallet en la API del producto: la misma que en la web, porque el passkey y la derivación son los mismos.
 *
 * Con la wallet desbloqueada entra sola (firmar el mensaje no pide Face ID: la llave ya está abierta) y lee si la cuenta
 * tiene username. Lo guarda con su dirección, así que en el siguiente arranque no pregunta ni desbloquea nada. Sólo una
 * respuesta del servidor que dice «sin username» abre la pantalla obligatoria, y sólo se queda abierta mientras el
 * servidor pueda atender la salida: si reclamar o volver a comprobar falla por algo que no es el username —sin red, 401,
 * 5xx—, la pantalla se suelta por esta sesión. La app opera fondos; la cuenta no puede dejar a nadie fuera de ellos.
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

  /** La cuenta tiene este username: se guarda y la app queda abierta. */
  const has = useCallback(async (w: Wallet, handle: string, stale: () => boolean) => {
    await saveIdentity({ address: w.address, handle, api: API_URL! });
    if (!stale()) setIdentity({ status: "has", handle });
  }, []);

  /** Pregunta al servidor por el username de esta wallet y deja el estado que corresponde. */
  const resolve = useCallback(async (w: Wallet, stale: () => boolean) => {
    try {
      const profile = await fetchProfile(API_URL!, (await ensureSession(w)).token);
      if (stale()) return;
      if (profile) await has(w, profile.handle, stale);
      // Un «sin username» leído antes de una reclamación que ya terminó no la deshace.
      else setIdentity((cur) => (cur.status === "has" ? cur : { status: "none" }));
    } catch {
      // No se pudo saber. No es «sin username»: nadie queda retenido por la red.
      if (!stale()) setIdentity((cur) => (cur.status === "has" ? cur : { status: "unreachable" }));
    }
  }, [ensureSession, has]);

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
      const stored = identityFor(await loadIdentity(), address, API_URL);
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
  const clearError = useCallback(() => setError(null), []);

  /**
   * Algo falló con la pantalla abierta. Antes de decir nada se vuelve a entrar y a leer la cuenta, porque el fallo pudo
   * ser sólo de la respuesta: el username quedó reclamado y no llegó el «sí», o la wallet se vinculó en la web y la
   * sesión era de una cuenta que ya no existe. Si la cuenta tiene username, eso es lo que vale. Si no, y el fallo no fue
   * del username, la pantalla se suelta.
   */
  const settle = useCallback(async (w: Wallet, failure: unknown, stale: () => boolean, words: (e: unknown) => string | null) => {
    session.current = undefined;
    let profile: { handle: string } | null;
    try {
      profile = await fetchProfile(API_URL!, (await ensureSession(w)).token);
    } catch {
      if (!stale()) setIdentity({ status: "unreachable" });
      return;
    }
    if (stale()) return;
    if (profile) { await has(w, profile.handle, stale); return; }
    if (isHandleRefusal(failure)) setError(words(failure));
    else setIdentity({ status: "unreachable" });
  }, [ensureSession, has]);

  const claim = useCallback(async (raw: string) => {
    if (API_URL === null) return;
    const requested = addressRef.current;
    const stale = () => isStaleAccount(requested, addressRef.current);
    setBusy(true);
    setError(null);
    try {
      let w: Wallet;
      try {
        // Si la wallet se bloqueó con la pantalla abierta, desbloquear pide Face ID; es la única vez que esto lo pide.
        w = await unlock();
      } catch (e) {
        // Face ID cancelado no es un error que decir (describeError lo deja vacío); otra cosa, sí.
        if (!stale()) setError(describeError(e) || null);
        return;
      }
      try {
        const claimed = await createProfile(API_URL, (await ensureSession(w)).token, normalizeHandle(raw));
        if (!stale()) await has(w, claimed.handle, stale);
      } catch (e) {
        if (!stale()) await settle(w, e, stale, describeIdentityError);
      }
    } finally {
      setBusy(false);
    }
  }, [ensureSession, has, settle, unlock]);

  const recheck = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (API_URL === null) return;
    const requested = addressRef.current;
    const stale = () => isStaleAccount(requested, addressRef.current);
    setBusy(true);
    setError(null);
    try {
      let w: Wallet;
      try {
        w = await unlock();
      } catch (e) {
        if (!stale() && !opts.quiet) setError(describeError(e) || null);
        return;
      }
      // La cuenta pudo cambiar en el servidor (se vinculó a otra): la sesión guardada es de la cuenta anterior.
      session.current = undefined;
      try {
        const profile = await fetchProfile(API_URL, (await ensureSession(w)).token);
        if (stale()) return;
        if (profile) await has(w, profile.handle, stale);
        else if (!opts.quiet) setError("This wallet's account still has no username.");
      } catch {
        // No se pudo preguntar: no es culpa de la persona ni del username, y la pantalla se suelta. Salvo en la
        // comprobación que la app hace sola al volver del navegador: ahí la red suele estar despertando, y soltar el
        // paso obligatorio sin que la persona haya hecho nada sería soltarlo por un parpadeo.
        if (!stale() && !opts.quiet) setIdentity({ status: "unreachable" });
      }
    } finally {
      setBusy(false);
    }
  }, [ensureSession, has, unlock]);

  return { identity, busy, error, clearError, check, claim, recheck };
}
