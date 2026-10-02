import type { Services } from "../app";

/** Shape-only services: mounting routes is allowed, invoking a service is always a bug. */
export function documentationServices(
  features: {
    studio?: boolean;
    growth?: boolean;
    custody?: boolean;
    walletAuth?: boolean;
    launches?: boolean;
  } = { studio: true, growth: true, custody: true, walletAuth: true, launches: true },
): Services {
  const blocked = new Proxy(
    () => {
      throw new Error("OpenAPI composition invoked a service");
    },
    {
      get: (_target, key) => (key === "then" ? undefined : blocked),
      apply: () => {
        throw new Error("OpenAPI composition invoked a service");
      },
    },
  );
  return {
    authenticate: blocked,
    authenticateAgent: blocked,
    findWorkspace: blocked,
    agentQueries: blocked,
    budgets: blocked,
    profiles: blocked,
    ...(features.studio ? { studio: blocked } : {}),
    ...(features.growth ? { growth: blocked } : {}),
    ...(features.custody ? { custody: blocked } : {}),
    ...(features.walletAuth ? { walletAuth: blocked } : {}),
    ...(features.launches ? { launches: blocked } : {}),
  } as unknown as Services;
}
