import { z } from "zod";
import { parseContext, type Context } from "@pickler/perpl-context";
import {
  dashboardMarkets,
  dashboardPortfolio,
  type PerplDashboardData,
  type DashboardWalletRead,
} from "@pickler/trading/perps";
import {
  perplDashboardMarketsSchema,
  perplPortfolioSchema,
  perplReadKeyPayloadSchema,
  perplReadKeyResultSchema,
  checkPerplReadPayload,
  PERPL_READ_KEY_LABEL,
  PERPL_DASHBOARD_ORIGIN,
  type PerplReadKeyInputDto,
  type PerplReadKeyEnrollDto,
} from "@pickler/api-schema";
const BASE = "https://testnet.perpl.xyz/api";
const EXCHANGE = "0x1964c32f0be608e7d29302aff5e61268e72080cc";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z
  .string()
  .regex(/^-?\d+$/)
  .max(80);
const walletSchema = z.object({
  mt: z.literal(19),
  sn: integer,
  addr: z.string(),
  as: z
    .array(z.object({ id: integer, in: integer, b: amount, lb: amount, fr: z.boolean() }))
    .max(100),
  sts: z
    .array(z.object({ id: integer, trp: amount, tf: amount, tv: amount }))
    .max(100)
    .optional(),
});
const positionsSchema = z.object({
  mt: z.literal(26),
  sn: integer,
  d: z
    .array(
      z.object({
        pid: integer,
        acc: integer,
        mkt: integer,
        st: integer,
        sd: z.union([z.literal(1), z.literal(2)]),
        s: integer,
        ep: integer,
        c: amount,
        lv: integer.positive(),
      }),
    )
    .max(500),
});
export class PerplDashboardError extends Error {
  constructor(
    readonly code:
      | "UNAVAILABLE"
      | "INVALID_RESPONSE"
      | "READ_ACCESS_EXPIRED"
      | "READ_ACCESS_DENIED"
      | "NO_PERPL_PROFILE"
      | "KEY_LIMIT"
      | "INVALID_AUTHORIZATION"
      | "AUTHORIZATION_STALE"
      | "AUTHORIZATION_REJECTED"
      | "INTEGRATION_NOT_ALLOWED"
      | "READ_SIGNATURE_REJECTED"
      | "READ_REQUEST_REJECTED"
      | "RATE_LIMITED",
    readonly upstreamStatus: number | null = null,
  ) {
    super(code);
    this.name = "PerplDashboardError";
  }
}
export class PerplDashboardGateway implements PerplDashboardData {
  private cached: { context: Context; at: number; instanceId: number } | null = null;
  private reading: Promise<{ context: Context; at: number; instanceId: number }> | null = null;
  private retryAfter = 0;
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  private async request(
    path: string,
    signal: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    const fetcher = this.fetcher;
    const response = await fetcher(BASE + path, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const enrolling = path.startsWith("/v1/api-key/");
      const codes: Record<number, PerplDashboardError["code"]> = {
        401: enrolling ? "AUTHORIZATION_REJECTED" : "READ_SIGNATURE_REJECTED",
        403: enrolling ? "INTEGRATION_NOT_ALLOWED" : "READ_ACCESS_DENIED",
        404: "NO_PERPL_PROFILE",
        423: "KEY_LIMIT",
        429: "RATE_LIMITED",
        400: enrolling ? "AUTHORIZATION_REJECTED" : "READ_REQUEST_REJECTED",
        422: enrolling ? "INTEGRATION_NOT_ALLOWED" : "READ_ACCESS_DENIED",
      };
      const accountRead = path.startsWith("/v1/trading/");
      const code =
        !enrolling && !accountRead && response.status !== 429
          ? "UNAVAILABLE"
          : (codes[response.status] ?? "UNAVAILABLE");
      throw new PerplDashboardError(code, response.status);
    }
    if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
      await response.body?.cancel();
      throw new PerplDashboardError("INVALID_RESPONSE");
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new PerplDashboardError("INVALID_RESPONSE");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new PerplDashboardError("INVALID_RESPONSE");
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
      reader.releaseLock();
    }
  }
  private async context(signal: AbortSignal) {
    if (this.cached && this.now() - this.cached.at < 10_000) {
      return this.cached;
    }
    if (!this.reading && this.now() >= this.retryAfter) {
      this.reading = this.request("/v1/pub/context", signal)
        .then((body) => {
          const context = parseContext(body);
          const identity = z
            .object({
              instances: z.array(z.object({ id: integer, collateral_token_id: integer })),
              tokens: z.array(z.object({ id: integer, address: z.string(), decimals: integer })),
            })
            .parse(body);
          const instance = identity.instances[0];
          const token = identity.tokens.find((t) => t.id === instance?.collateral_token_id);
          if (
            !instance ||
            token?.address.toLowerCase() !== "0xa9012a055bd4e0edff8ce09f960291c09d5322dc" ||
            token.decimals !== 6
          ) {
            throw new PerplDashboardError("INVALID_RESPONSE");
          }
          if (context.chainId !== 10143 || context.instance.exchange.toLowerCase() !== EXCHANGE) {
            throw new PerplDashboardError("INVALID_RESPONSE");
          }
          for (const market of context.markets) {
            if (
              ![
                market.id,
                market.mark,
                market.prev,
                market.priceDecimals,
                market.sizeDecimals,
              ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
              market.priceDecimals > 18 ||
              market.sizeDecimals > 18 ||
              !/^[\w-]{1,30}$/.test(market.symbol) ||
              market.mark <= 0
            ) {
              throw new PerplDashboardError("INVALID_RESPONSE");
            }
            if (market.fundingRate !== null && !Number.isSafeInteger(market.fundingRate)) {
              market.fundingRate = null;
            }
            if (
              market.openInterest !== null &&
              (!Number.isSafeInteger(market.openInterest) || market.openInterest < 0)
            ) {
              market.openInterest = null;
            }
          }
          this.cached = { context, at: this.now(), instanceId: instance.id };
          return this.cached;
        })
        .catch((error: unknown) => {
          this.retryAfter = this.now() + 10_000;
          throw error;
        });
      void this.reading
        .finally(() => {
          this.reading = null;
        })
        .catch(() => {});
    }
    try {
      if (this.reading) {
        return await this.reading;
      }
    } catch (error) {
      if (!this.cached || this.now() - this.cached.at > 60_000) {
        throw error;
      }
    }
    if (this.cached && this.now() - this.cached.at <= 60_000) {
      return this.cached;
    }
    throw new PerplDashboardError("UNAVAILABLE");
  }
  async markets(signal: AbortSignal) {
    const result = await this.context(signal);
    return perplDashboardMarketsSchema.parse({
      chainId: 10143,
      observedAt: new Date(result.at).toISOString(),
      serverTimeMs: this.now(),
      stale: this.now() - result.at >= 10_000,
      ...dashboardMarkets(result.context.markets),
    });
  }
  async payload(input: PerplReadKeyInputDto, signal: AbortSignal) {
    if (input.expiresAt > this.now() + 3_600_000 || input.expiresAt < this.now() + 60_000) {
      throw new PerplDashboardError("INVALID_AUTHORIZATION");
    }
    const body = await this.request("/v1/api-key/payload", signal, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: PERPL_DASHBOARD_ORIGIN },
      body: JSON.stringify({
        chain_id: 10143,
        address: input.wallet,
        public_key: input.publicKey,
        scope_mask: 1,
        label: PERPL_READ_KEY_LABEL,
        expires_at: input.expiresAt,
      }),
    });
    const raw = z.object({ typed_data: z.unknown(), mac: z.string() }).parse(body);
    const payload = perplReadKeyPayloadSchema.parse({ typedData: raw.typed_data, mac: raw.mac });
    const publicKey = Uint8Array.from(input.publicKey.slice(2).match(/../g)!, (b) =>
      parseInt(b, 16),
    );
    const encoded = btoa(String.fromCharCode(...publicKey))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    return checkPerplReadPayload(payload, input, encoded, this.now());
  }
  async enroll(input: PerplReadKeyEnrollDto, signal: AbortSignal) {
    const message = input.typedData.message;
    if (
      message.signer.toLowerCase() !== input.wallet.toLowerCase() ||
      Number(message.expiresAt) > this.now() + 3_600_000
    ) {
      throw new PerplDashboardError("INVALID_AUTHORIZATION");
    }
    if (
      Number(message.expiresAt) <= this.now() ||
      Math.abs(Number(BigInt(message.time)) - this.now()) > 30_000
    ) {
      throw new PerplDashboardError("AUTHORIZATION_STALE");
    }
    const body = await this.request("/v1/api-key/enroll", signal, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: PERPL_DASHBOARD_ORIGIN },
      body: JSON.stringify({
        chain_id: 10143,
        address: input.wallet,
        typed_data: input.typedData,
        mac: input.mac,
        signature: input.signature,
        pop_signature: input.popSignature,
      }),
    });
    const raw = z
      .object({
        api_key: z.object({
          api_key: z.string(),
          address: z.string(),
          scope_mask: z.literal(1),
          expires_at: integer,
        }),
      })
      .parse(body);
    if (
      raw.api_key.address.toLowerCase() !== input.wallet.toLowerCase() ||
      raw.api_key.expires_at !== Number(message.expiresAt)
    ) {
      throw new PerplDashboardError("INVALID_RESPONSE");
    }
    return perplReadKeyResultSchema.parse({
      apiKey: raw.api_key.api_key,
      wallet: raw.api_key.address,
      scope: 1,
      expiresAt: raw.api_key.expires_at,
    });
  }
  async portfolio(input: DashboardWalletRead, signal: AbortSignal) {
    const proofs = [input.walletProof, input.positionsProof];
    if (
      proofs[0]!.apiKey !== proofs[1]!.apiKey ||
      proofs[0]!.nonce === proofs[1]!.nonce ||
      proofs.some((p) => Math.abs(Number(p.timestamp) - this.now()) > 30_000)
    ) {
      throw new PerplDashboardError("INVALID_AUTHORIZATION");
    }
    const read = (path: string, proof: (typeof proofs)[number]) =>
      this.request(path, signal, {
        headers: {
          Origin: PERPL_DASHBOARD_ORIGIN,
          "X-API-Key": proof.apiKey,
          "X-API-Timestamp": proof.timestamp,
          "X-API-Nonce": proof.nonce,
          "X-API-Signature": proof.signature,
        },
      });
    // Two fixed GET targets only. Never forward a client URL, HTTP method, body or arbitrary header.
    const [rawWallet, rawPositions, market] = await Promise.all([
      read("/v1/trading/wallet", input.walletProof),
      read("/v1/trading/positions", input.positionsProof),
      this.context(signal),
    ]);
    const wallet = walletSchema.parse(rawWallet);
    const positions = positionsSchema.parse(rawPositions);
    if (
      wallet.addr.toLowerCase() !== input.wallet.toLowerCase() ||
      Math.abs(wallet.sn - positions.sn) > 100
    ) {
      throw new PerplDashboardError("INVALID_RESPONSE");
    }
    if (
      new Set(wallet.as.map((a) => a.id)).size !== wallet.as.length ||
      new Set(positions.d.map((p) => p.pid)).size !== positions.d.length ||
      new Set((wallet.sts ?? []).map((s) => s.id)).size !== (wallet.sts ?? []).length
    ) {
      throw new PerplDashboardError("INVALID_RESPONSE");
    }
    const allIds = new Set(wallet.as.map((a) => a.id));
    if (positions.d.some((p) => !allIds.has(p.acc))) {
      throw new PerplDashboardError("INVALID_RESPONSE");
    }
    const accounts = wallet.as.filter((a) => a.in === market.instanceId);
    const selectedIds = new Set(accounts.map((a) => a.id));
    const result = dashboardPortfolio({
      accounts: accounts.map((a) => ({ id: a.id, balance: a.b, locked: a.lb, frozen: a.fr })),
      stats: (wallet.sts ?? [])
        .filter((s) => selectedIds.has(s.id))
        .map((s) => ({
          accountId: s.id,
          realizedPnl: s.trp,
          fees: s.tf,
          volume: s.tv,
        })),
      positions: positions.d
        .filter((p) => p.st === 1 && selectedIds.has(p.acc))
        .map((p) => ({
          id: p.pid,
          accountId: p.acc,
          marketId: p.mkt,
          side: p.sd === 1 ? "long" : "short",
          size: p.s,
          entry: p.ep,
          collateral: p.c,
          leverage: p.lv / 100,
        })),
      markets: market.context.markets,
    });
    return perplPortfolioSchema.parse({
      ...result,
      wallet: wallet.addr,
      chainId: 10143,
      observedAt: new Date(this.now()).toISOString(),
      marketObservedAt: new Date(market.at).toISOString(),
      block: Math.min(wallet.sn, positions.sn),
      stale: this.now() - market.at >= 10_000,
    });
  }
}
