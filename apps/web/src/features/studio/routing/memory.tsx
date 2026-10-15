"use client";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getSupabase } from "@/features/auth/lib/supabase-browser";
import { createStudioMemory, type StudioMemory } from "./memory-store";
const MemoryContext = createContext<StudioMemory | null>(null);
export function StudioMemoryProvider({ children }: { children: ReactNode }) {
  const [memory] = useState(createStudioMemory);
  useSyncExternalStore(memory.subscribe, memory.snapshot, memory.snapshot);
  useEffect(() => {
    const auth = getSupabase()?.auth;
    const subscription = auth?.onAuthStateChange((_event, session) =>
      memory.identify(session?.user.id ?? null),
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (memory.dirty() || memory.writing()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [memory]);
  return (
    <MemoryContext.Provider value={memory}>
      <Fragment key={memory.generation()}>{children}</Fragment>
    </MemoryContext.Provider>
  );
}
export function useStudioMemory() {
  const memory = useContext(MemoryContext);
  if (!memory) {
    throw new Error("Studio requires its workspace memory provider.");
  }
  useSyncExternalStore(memory.subscribe, memory.snapshot, memory.snapshot);
  return memory;
}
export function useStudioForm<T>(key: string, version: number, saved: T): [T, (next: T) => void] {
  const memory = useStudioMemory();
  return [memory.form(key, version, saved), (next) => memory.edit(key, next)];
}
