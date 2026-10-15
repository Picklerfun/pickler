import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 767px)";
const serverSnapshot = () => false;
const snapshot = () => window.matchMedia(MOBILE_QUERY).matches;
function subscribe(listener: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
