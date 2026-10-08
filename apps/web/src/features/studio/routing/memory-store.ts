/** Memory-only form drafts. No secrets, tokens or provider content belong here. */
interface DraftEntry {
  value: unknown;
  saved: unknown;
  version: number;
  dirty: boolean;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function createStudioMemory() {
  const forms = new Map<string, DraftEntry>();
  const outcomes = new Map<string, unknown>();
  const writes = new Map<string, number>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let owner: string | null = null;
  let identified = false;
  let generation = 0;
  const emit = () => {
    revision += 1;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => revision,
    generation: () => generation,
    discardForms() {
      forms.clear();
      emit();
    },
    identify(userId: string | null) {
      // Initial authentication assigns this fresh store without restarting its first bootstrap.
      if (!identified) {
        identified = true;
        owner = userId;
        return;
      }
      if (owner === userId) {
        return;
      }
      owner = userId;
      generation += 1;
      forms.clear();
      writes.clear();
      outcomes.clear();
      emit();
    },
    form<T>(key: string, version: number, saved: T): T {
      const previous = forms.get(key);
      if (
        !previous ||
        (!previous.dirty && (previous.version !== version || !same(previous.saved, saved)))
      ) {
        forms.set(key, { value: saved, saved, version, dirty: false });
        return saved;
      }
      return previous.value as T;
    },
    edit<T>(key: string, value: T) {
      const entry = forms.get(key);
      if (!entry) {
        throw new Error("Form was not registered.");
      }
      entry.value = value;
      entry.dirty = !same(value, entry.saved);
      emit();
    },
    outcome<T>(scope: string, fallback: T): T {
      return (outcomes.get(scope) as T | undefined) ?? fallback;
    },
    setOutcome(scope: string, value: unknown) {
      outcomes.set(scope, value);
      emit();
    },
    stale(scope: string, version: number) {
      return [...forms].some(
        ([key, entry]) => key.startsWith(`${scope}:`) && entry.dirty && entry.version !== version,
      );
    },
    begin(scope: string) {
      writes.set(scope, (writes.get(scope) ?? 0) + 1);
      emit();
    },
    end(scope: string) {
      const count = (writes.get(scope) ?? 1) - 1;
      if (count) {
        writes.set(scope, count);
      } else {
        writes.delete(scope);
      }
      emit();
    },
    busy(scope: string) {
      return (writes.get(scope) ?? 0) > 0;
    },
    committed(scope: string) {
      for (const [key, entry] of forms) {
        if (key.startsWith(`${scope}:`)) {
          entry.dirty = false;
        }
      }
      emit();
    },
    discard(scope: string) {
      for (const key of forms.keys()) {
        if (key.startsWith(`${scope}:`)) {
          forms.delete(key);
        }
      }
      emit();
    },
    dirty: () => [...forms.values()].some((entry) => entry.dirty),
    writing: () => writes.size > 0,
    clear() {
      forms.clear();
      writes.clear();
      outcomes.clear();
      emit();
    },
  };
}
export type StudioMemory = ReturnType<typeof createStudioMemory>;
