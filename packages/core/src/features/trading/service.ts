import { PilotError, type AgentRecord, type Scope, type RunRecord } from "../research/types.js";
import { pluginEnabled, requireTool } from "../research/plugins.js";
import { assertConfiguredMarket, protocolForMarket } from "../research/market-scope.js";
import type { BuyRequest, LivePreview, TradingRepository, TradingProvider } from "./types.js";

export function moneyMicros(value: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new PilotError("INVALID_INPUT", "Expected a nonnegative decimal with up to six places");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PilotError("INVALID_INPUT", "Amount exceeds supported range");
  }
  return Number(amount);
}
export function assertTradingAgent(agent: AgentRecord): void {
  if (agent.tenantId !== "alpha" || agent.id !== "pickle-alpha") {
    throw new PilotError(
      "TRADING_ACCOUNT_UNAVAILABLE",
      "Only the dedicated alpha pilot is supported",
    );
  }
  if (agent.paused || !agent.config.trading || agent.config.trading.mode === "off") {
    throw new PilotError("TRADING_DISABLED", "Trading is disabled");
  }
  if (!pluginEnabled(agent.config, "polymarket-trading")) {
    throw new PilotError("PLUGIN_DISABLED", "Trading plugin is disabled");
  }
  requireTool(agent.config, "getMarketRules");
  requireTool(agent.config, "getOrderBook");
}
export function assertLivePreview(preview: LivePreview, agent: AgentRecord, now: number): void {
  assertTradingAgent(agent);
  assertConfiguredMarket(preview.market, agent.config, now);
  if (protocolForMarket(preview.market, agent.config) !== "nfl-winner-v1") {
    throw new PilotError("TRADING_UNSUPPORTED_MARKET", "Only NFL full-game winners are supported");
  }
  if (
    preview.marketId !== preview.market.id ||
    !preview.market.outcomes.some((o) => o.id === preview.outcomeId)
  ) {
    throw new PilotError("INVALID_INPUT", "Outcome does not belong to the selected market");
  }
  const budget = moneyMicros(preview.budget);
  const limit = moneyMicros(preview.limitPrice);
  if (budget <= 0 || budget > 5000000 || limit <= 0 || limit >= 1000000) {
    throw new PilotError(
      "TRADING_LIMIT",
      "Maximum five pUSD per purchase and a price strictly between zero and one",
    );
  }
  if (
    !Number.isFinite(preview.observedAt) ||
    preview.observedAt > now ||
    now - preview.observedAt > 30000
  ) {
    throw new PilotError("STALE_QUOTE", "Trading quote must be no older than thirty seconds");
  }
}
export function assertTradingRun(run: RunRecord, agent: AgentRecord, now: number): BuyRequest {
  assertTradingAgent(agent);
  const d = run.decision;
  if (
    run.configVersion !== agent.version ||
    run.status !== "completed" ||
    !d ||
    d.action !== "TRADE" ||
    !("policyEvaluation" in d) ||
    d.policyEvaluation.finalAction !== "TRADE" ||
    !d.outcomeId ||
    !d.limitPrice ||
    !d.expiresAt ||
    !Number.isFinite(Date.parse(d.expiresAt)) ||
    Date.parse(d.expiresAt) <= now ||
    !("schemaVersion" in d) ||
    ![3, 4].includes(d.schemaVersion) ||
    (d.schemaVersion === 4 && d.protocol !== "nfl-winner-v1")
  ) {
    throw new PilotError("TRADING_RUN_INELIGIBLE", "Requires a current policy-approved NFL trade");
  }
  return { marketId: d.marketId, outcomeId: d.outcomeId, limitPrice: d.limitPrice, budget: "5" };
}
export function createTradingService(
  repository: TradingRepository,
  provider: TradingProvider,
  now = Date.now,
) {
  async function inspect(scope: Scope) {
    const agent = await repository.agent(scope);
    assertTradingAgent(agent);
    const account = await repository.account(scope);
    const identity = provider.identity();
    if (
      identity.wallet.toLowerCase() !== account.wallet.toLowerCase() ||
      identity.signer.toLowerCase() !== account.signer.toLowerCase()
    ) {
      throw new PilotError(
        "TRADING_IDENTITY_CHANGED",
        "Configured signer does not match the bound account",
      );
    }
    return agent;
  }
  async function prepare(scope: Scope, request: BuyRequest, key: string, runId?: string) {
    const agent = await inspect(scope);
    const signal = AbortSignal.timeout(25000);
    const state = await provider.check(signal);
    if (
      state.blocked ||
      !state.approved ||
      moneyMicros(state.balance) < moneyMicros(request.budget)
    ) {
      throw new PilotError(
        "TRADING_NOT_READY",
        "Account access, approvals or balance do not permit the purchase",
      );
    }
    const current = await inspect(scope);
    if (current.version !== agent.version) {
      throw new PilotError("CONFIG_CHANGED", "Configuration changed during preparation");
    }
    const preview = await provider.preview(request, signal);
    assertLivePreview(preview, agent, now());
    return repository.prepare(scope, preview, key, runId);
  }
  return {
    async check(scope: Scope) {
      await inspect(scope);
      return provider.check(AbortSignal.timeout(25000));
    },
    account: (scope: Scope) => repository.account(scope),
    list: (scope: Scope) => repository.list(scope),
    get: (tenant: string, id: string) => repository.get(tenant, id),
    prepare,
    submit: (tenant: string, id: string, key: string) => repository.enqueue(tenant, id, key),
    async fromRun(tenant: string, id: string, key: string) {
      const run = await repository.run(tenant, id);
      const scope = { tenantId: tenant, agentId: run.agentId };
      const agent = await inspect(scope);
      const request = assertTradingRun(run, agent, now());
      const order = await prepare(scope, request, key, id);
      return repository.enqueue(tenant, order.id, key);
    },
    async tick() {
      // Recovery is read-only at the provider. It must run even after plugin revocation.
      for (const order of await repository.pending()) {
        try {
          const identity = provider.identity();
          const account = await repository.account(order);
          if (identity.wallet.toLowerCase() !== account.wallet.toLowerCase()) {
            continue;
          }
          await repository.complete(
            order,
            await provider.reconcile(order, AbortSignal.timeout(20000)),
          );
        } catch {
          /* Keep unresolved reservations; do not infer failure from an unavailable provider. */
        }
      }
      for (const run of await repository.automaticCandidates()) {
        try {
          await this.fromRun(run.tenantId, run.id, `automatic:${run.id}`);
        } catch {
          /* No fallback decision or external write retry. */
        }
      }
      const order = await repository.claim();
      if (!order) {
        return;
      }
      let submitting = false;
      try {
        const agent = await inspect(order);
        const signal = AbortSignal.timeout(45000);
        await repository.guard(order);
        const state = await provider.check(signal);
        if (
          state.blocked ||
          !state.approved ||
          moneyMicros(state.balance) < moneyMicros(order.preview.budget)
        ) {
          throw new PilotError("TRADING_NOT_READY", "Account is not ready");
        }
        await repository.guard(order);
        const fresh = await provider.preview(order.preview, signal);
        assertLivePreview(fresh, agent, now());
        await repository.guard(order);
        const signed = await provider.sign(fresh, signal);
        await repository.markSubmitting(order, signed.hash, fresh);
        // Durable handoff: never send a newly created order after this point on recovery.
        submitting = true;
        await provider.submit(signed.payload, signal);
        await repository.complete(
          { ...order, orderHash: signed.hash },
          await provider.reconcile({ ...order, orderHash: signed.hash }, signal),
        );
      } catch (error) {
        if (!submitting) {
          await repository.failUnsent(
            order,
            error instanceof PilotError ? error.code : "TRADING_PROVIDER_FAILURE",
          );
        }
      }
    },
  };
}
