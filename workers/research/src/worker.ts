import {
  consumeAdvice,
  consumePerpsCheck,
  perpsAdmission,
  reconcileAdvice,
  consumeWakeup,
  reconcile,
  superviseChecks,
  type AdviceBackground,
  type PerpsBackground,
  type PerpsCheckMessage,
} from "@pickler/agent-runtime";
import type { PostgresResearchStore } from "@pickler/infrastructure";
import type { createRuntime } from "@pickler/agent-runtime";
import type { Env } from "./index.js";

export type ResearchMessage = { kind: "research-wakeup" | "advice-wakeup" } | PerpsCheckMessage;

type Runtime = Pick<ReturnType<typeof createRuntime>, "repository" | "execute"> &
  Partial<Pick<ReturnType<typeof createRuntime>, "previews">>;

/** Dependency injection is for host tests, never an environment-selected provider fallback. */
export function createResearchWorker(deps: {
  runtime(env: Env): Runtime;
  adviceRuntime?(env: Env): AdviceBackground;
  perpsRuntime?(env: Env): PerpsBackground;
  repository(env: Env): PostgresResearchStore;
}): ExportedHandler<Env, ResearchMessage> {
  return {
    async queue(batch, env) {
      for (const message of batch.messages) {
        if (message.body?.kind === "perps-check") {
          // Off, the check is claimed and refused (RUNTIME_DISABLED) without reading or asking.
          try {
            if (!deps.perpsRuntime) {
              throw new Error("Perpl runtime unavailable");
            }
            await consumePerpsCheck(
              deps.perpsRuntime(env),
              message.body.checkId,
              perpsAdmission(env),
            );
            message.ack();
          } catch {
            console.error("Perpl check delivery failed; it is retried or expires");
            message.retry({ delaySeconds: 30 });
          }
          continue;
        }
        if (message.body?.kind === "advice-wakeup") {
          if (env.ADVICE_ENABLED !== "true") {
            message.ack();
            continue;
          }
          try {
            if (!deps.adviceRuntime) {
              throw new Error("Advice runtime unavailable");
            }
            await consumeAdvice(deps.adviceRuntime(env), async () => {
              await env.RESEARCH_QUEUE.send({ kind: "advice-wakeup" });
            });
            message.ack();
          } catch {
            console.error("Advice wakeup failed; durable state will be reconciled");
            message.retry({ delaySeconds: 30 });
          }
          continue;
        }
        if (env.ADMISSIONS_ENABLED !== "true" || message.body?.kind !== "research-wakeup") {
          message.ack();
          continue;
        }
        try {
          const runtime = deps.runtime(env);
          await consumeWakeup(
            runtime.repository,
            runtime.execute,
            {
              send: async (body) => {
                await env.RESEARCH_QUEUE.send(body);
              },
            },
            Date.now,
            runtime.previews,
          );
          try {
            await env.TRADING_QUEUE?.send({ kind: "trading-wakeup" });
          } catch {
            console.error("Trading wakeup awaits reconciliation");
          }
          message.ack();
        } catch {
          console.error("Research wakeup failed; durable state will be reconciled");
          message.retry({ delaySeconds: 30 });
        }
      }
    },
    async scheduled(_event, env) {
      const admission = perpsAdmission(env);
      if (admission.enabled && deps.perpsRuntime) {
        try {
          await superviseChecks(deps.perpsRuntime(env), admission, async (body) => {
            await env.RESEARCH_QUEUE.send(body);
          });
        } catch {
          console.error("Perpl runtime supervision failed; research supervision continues");
        }
      }
      if (deps.adviceRuntime) {
        try {
          await reconcileAdvice(
            deps.adviceRuntime(env),
            env.ADVICE_ENABLED === "true",
            async () => {
              await env.RESEARCH_QUEUE.send({ kind: "advice-wakeup" });
            },
          );
        } catch {
          console.error("Advice reconciliation failed; research supervision continues");
        }
      }
      const repository = deps.repository(env);
      if (env.ADMISSIONS_ENABLED !== "true") {
        try {
          await repository.recover(Date.now());
        } finally {
          await repository.close();
        }
        return;
      }
      await reconcile(repository, {
        send: async (body) => {
          await env.RESEARCH_QUEUE.send(body);
        },
      });
    },
  };
}
