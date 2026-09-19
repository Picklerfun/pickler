// Ported from Relayer apps/api/src/core/auth/constants/modules.ts (commit bb6bb1226e92).
// Values match `public.integrators.active_modules`, which Relayer and Pickler share.

/** Always active for every integrator; cannot be toggled off. */
export const CORE_MODULES = ["signing", "payout"] as const;

/** Toggled per integrator through `active_modules`. */
export const TOGGLEABLE_MODULES = ["action", "agent"] as const;

export const ALL_MODULES = [...CORE_MODULES, ...TOGGLEABLE_MODULES] as const;
export type Module = (typeof ALL_MODULES)[number];

/** A route requiring several modules passes when ANY of them is active (Relayer's OR semantics). */
export function hasActiveModule(
  required: readonly string[],
  activeModules: readonly string[] | null | undefined,
): boolean {
  if (required.length === 0) {
    return true;
  }
  const active = new Set<string>([...CORE_MODULES, ...(activeModules ?? [])]);
  return required.some((module) => active.has(module));
}
