import * as Notif from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { REMINDER_PRE_MS, reminderKinds } from "../reads/level";
import { localReminderContent, localResolutionContent, pushEnvFor, type PushTarget, pushTargetOf } from "../reads/push";
import type { Read } from "../reads/types";
import type { TradeLevel } from "../store";

export type PushDevice = { token: string; env: "sandbox" | "production" };
export type PushPermission = "unknown" | "granted" | "denied" | "unavailable";

export type Notifications = {
  /** Token APNs del dispositivo, si hay permiso y el registro funcionó. */
  device: PushDevice | null;
  permission: PushPermission;
  /** Pide permiso (la primera vez que se confirma una lectura, D10/P6) y registra el token. */
  ensurePermission: () => Promise<PushDevice | null>;
  /** Fallback D10 (PUSH_MODE === "local"): notificación local al vencer la read. */
  scheduleLocal: (read: Read) => Promise<void>;
  /** Fallback D10 para «Trade this level» (PUSH_MODE === "local"): `pre` (si faltan > 15 min) y `expiry`, sin mark. */
  scheduleLocalReminders: (symbol: string, level: TradeLevel) => Promise<void>;
};

// Con la app en primer plano el push se muestra igual (banner + lista): así se ve llegar en el simulador.
Notif.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const targetOfResponse = (r: Notif.NotificationResponse): PushTarget | null =>
  pushTargetOf(r.notification.request.content.data, (r.notification.request.trigger as { payload?: unknown } | null)?.payload);

export function useNotifications(onTarget: (t: PushTarget) => void): Notifications {
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [permission, setPermission] = useState<PushPermission>("unknown");
  const onTargetRef = useRef(onTarget);
  onTargetRef.current = onTarget;
  const handled = useRef<string | null>(null); // identifier de la última respuesta ya navegada

  const register = useCallback(async (): Promise<PushDevice | null> => {
    try {
      const t = await Notif.getDevicePushTokenAsync();
      if (t.type !== "ios" || typeof t.data !== "string") { setPermission("unavailable"); return null; }
      const d = { token: t.data, env: pushEnvFor(__DEV__) };
      setDevice(d);
      return d;
    } catch (e) {
      console.warn(`push token: ${e instanceof Error ? e.message : e}`); // simulador sin soporte, sin entitlement…
      setPermission("unavailable");
      return null;
    }
  }, []);

  // Arranque: si ya hay permiso, registra el token sin preguntar nada.
  useEffect(() => {
    let stale = false;
    Notif.getPermissionsAsync()
      .then((p) => { if (stale) return; if (p.granted) { setPermission("granted"); void register(); } else if (p.status === "denied") setPermission("denied"); })
      .catch(() => { if (!stale) setPermission("unavailable"); });
    return () => { stale = true; };
  }, [register]);

  // Tap en un push: en caliente (listener) y en frío (última respuesta), una sola vez por respuesta.
  useEffect(() => {
    const handle = (r: Notif.NotificationResponse | null) => {
      if (!r || handled.current === r.notification.request.identifier) return;
      handled.current = r.notification.request.identifier;
      const t = targetOfResponse(r);
      if (t) onTargetRef.current(t);
    };
    const sub = Notif.addNotificationResponseReceivedListener(handle);
    Notif.getLastNotificationResponseAsync().then(handle).catch(() => {});
    return () => sub.remove();
  }, []);

  const ensurePermission = useCallback(async (): Promise<PushDevice | null> => {
    if (device) return device;
    if (permission === "denied" || permission === "unavailable") return null;
    try {
      const p = await Notif.requestPermissionsAsync();
      if (!p.granted) { setPermission("denied"); return null; }
      setPermission("granted");
      return await register();
    } catch {
      setPermission("unavailable");
      return null;
    }
  }, [device, permission, register]);

  const scheduleLocal = useCallback(async (read: Read) => {
    const date = new Date(read.expiresAt);
    if (date.getTime() <= Date.now()) return;
    await Notif.scheduleNotificationAsync({ identifier: `read-${read.id}`, content: localResolutionContent(read), trigger: { type: Notif.SchedulableTriggerInputTypes.DATE, date } });
  }, []);

  const scheduleLocalReminders = useCallback(async (symbol: string, level: TradeLevel) => {
    const now = Date.now();
    const expiry = Date.parse(level.expiresAt);
    for (const kind of reminderKinds(level, now)) {
      const date = new Date(kind === "pre" ? expiry - REMINDER_PRE_MS : expiry);
      if (date.getTime() <= now) continue;
      await Notif.scheduleNotificationAsync({
        identifier: `reminder-${kind}-${level.marketId}-${level.expiresAt}`,
        content: localReminderContent(symbol, level, kind),
        trigger: { type: Notif.SchedulableTriggerInputTypes.DATE, date },
      });
    }
  }, []);

  return { device, permission, ensurePermission, scheduleLocal, scheduleLocalReminders };
}
