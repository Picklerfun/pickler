import {
  createPublicClient,
  createSecureClient,
  OrderSide,
  OrderType,
  WalletType,
  type SecureClientOptions,
  type SignedOrder,
  type TypedDataPayload,
} from "@polymarket/client";
import { fetchBalanceAllowance, isWalletDeployed } from "@polymarket/client/actions";
import { privateKey } from "@polymarket/client/viem";
import { hashTypedData, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  PilotError,
  moneyMicros,
  type TradingProvider,
  type BuyRequest,
  type LivePreview,
  type LiveOrder,
  type Reconciliation,
} from "@pickler/core";
import { PolymarketData } from "./market-data.js";

export interface TradingCredentials {
  wallet: string;
  signer: string;
  privateKey: string;
  apiKey: string;
  secret: string;
  passphrase: string;
}
export function tradingOrderHash(payload: TypedDataPayload): string {
  if (
    payload.domain.chainId !== 137 ||
    payload.domain.name !== "Polymarket CTF Exchange" ||
    !payload.types.Order
  ) {
    throw new PilotError("TRADING_SIGNED_ORDER_INVALID", "Unexpected exchange signing domain");
  }
  const message =
    payload.primaryType === "TypedDataSign" ? payload.message.contents : payload.message;
  if (
    !["Order", "TypedDataSign"].includes(payload.primaryType) ||
    !message ||
    typeof message !== "object"
  ) {
    throw new PilotError("TRADING_SIGNED_ORDER_INVALID", "Unsupported signing envelope");
  }
  return hashTypedData({
    domain: payload.domain,
    types: { Order: payload.types.Order },
    primaryType: "Order",
    message,
  } as Parameters<typeof hashTypedData>[0]);
}
/** No constructor/startup calls. Never deploys wallets, grants approvals or sends transactions. */
export class PolymarketTrading implements TradingProvider {
  constructor(
    private credentials: TradingCredentials,
    private markets = new PolymarketData(),
    private clientFactory?: (
      onHash?: (hash: string) => void,
    ) => Promise<Awaited<ReturnType<typeof createSecureClient>>>,
  ) {
    if (
      !/^0x[0-9a-f]{64}$/i.test(credentials.privateKey) ||
      !/^0x[0-9a-f]{40}$/i.test(credentials.wallet) ||
      privateKeyToAccount(credentials.privateKey as `0x${string}`).address.toLowerCase() !==
        credentials.signer.toLowerCase()
    ) {
      throw new PilotError("TRADING_CONFIG_INVALID", "Trading identity is inconsistent");
    }
  }
  identity() {
    return { wallet: this.credentials.wallet, signer: this.credentials.signer };
  }
  private async client(onHash?: (hash: string) => void) {
    if (this.clientFactory) {
      return this.clientFactory(onHash);
    }
    const deployed = await isWalletDeployed(createPublicClient(), {
      wallet: this.credentials.wallet,
      type: WalletType.DEPOSIT_WALLET,
    });
    if (!deployed) {
      throw new PilotError(
        "TRADING_NOT_CONFIGURED",
        "Deploy the dedicated Deposit Wallet explicitly first",
      );
    }
    const signer = privateKey(this.credentials.privateKey);
    const signTypedData = signer.signTypedData.bind(signer);
    signer.signTypedData = async (payload) => {
      if (["Order", "TypedDataSign"].includes(payload.primaryType)) {
        onHash?.(tradingOrderHash(payload));
      }
      return signTypedData(payload);
    };
    // Runtime credentials must exist already; bootstrap is an operator-only command.
    return createSecureClient({
      wallet: this.credentials.wallet,
      signer,
      credentials: {
        key: this.credentials.apiKey,
        secret: this.credentials.secret,
        passphrase: this.credentials.passphrase,
      } as NonNullable<SecureClientOptions["credentials"]>,
    });
  }
  async check(signal: AbortSignal) {
    signal.throwIfAborted();
    const response = await fetch("https://polymarket.com/api/geoblock", {
      signal,
      redirect: "manual",
    });
    if (!response.ok) {
      throw new PilotError("TRADING_ACCESS_CHECK_FAILED", "Unable to check trading access");
    }
    const geo = z.object({ blocked: z.boolean() }).parse(await response.json());
    if (geo.blocked) {
      return { blocked: true, approved: false, balance: "0" };
    }
    const client = await this.client();
    signal.throwIfAborted();
    const [balance, approvals] = await Promise.all([
      fetchBalanceAllowance(client, { assetType: "COLLATERAL" as never }),
      client.fetchTradingApprovalsState(),
    ]);
    signal.throwIfAborted();
    return {
      blocked: false,
      approved: approvals.isFullyApproved,
      balance: formatUnits(BigInt(balance.balance), 6),
    };
  }
  async preview(request: BuyRequest, signal: AbortSignal): Promise<LivePreview> {
    const market = await this.markets.get(request.marketId, signal);
    const conditions = await this.markets.conditions(request.marketId, request.outcomeId, signal);
    const book = await this.markets.book(request.outcomeId, signal);
    const budget = moneyMicros(request.budget) / 1000000;
    const cap = moneyMicros(request.limitPrice) / 1000000;
    const rate = Number(conditions.feeRate);
    if (
      budget <= 0 ||
      budget > 5 ||
      conditions.feeExponent !== 1 ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 1
    ) {
      throw new PilotError(
        "TRADING_MINIMUM_OR_FEES",
        "Unsupported fee conditions or market minimum",
      );
    }
    let remaining = budget,
      shares = 0,
      fees = 0;
    for (const level of book.asks) {
      const price = Number(level.price);
      if (price > cap) {
        break;
      }
      const perShareFee = rate * price * (1 - price);
      const quantity = Math.min(Number(level.size), remaining / (price + perShareFee));
      shares += quantity;
      fees += quantity * perShareFee;
      remaining -= quantity * (price + perShareFee);
      if (remaining < 0.000001) {
        break;
      }
    }
    if (remaining > 0.00001 || !shares || shares < Number(conditions.minimumNotional)) {
      throw new PilotError("TRADING_DEPTH", "Insufficient full-fill depth at the price limit");
    }
    return {
      ...request,
      market,
      estimatedShares: shares.toFixed(6),
      estimatedFee: fees.toFixed(6),
      observedAt: Date.parse(book.observedAt),
    };
  }
  async sign(preview: LivePreview, signal: AbortSignal) {
    signal.throwIfAborted();
    let hash = "";
    const client = await this.client((value) => {
      hash = value;
    });
    signal.throwIfAborted();
    const payload = await client.createMarketOrder({
      tokenId: preview.outcomeId,
      side: OrderSide.BUY,
      amount: preview.budget,
      maxSpend: preview.budget,
      maxPrice: preview.limitPrice,
      orderType: OrderType.FOK,
    });
    signal.throwIfAborted();
    if (
      !hash ||
      payload.orderType !== OrderType.FOK ||
      payload.maker.toLowerCase() !== this.credentials.wallet.toLowerCase() ||
      payload.tokenId !== preview.outcomeId ||
      payload.side !== OrderSide.BUY ||
      BigInt(payload.makerAmount) <= 0n ||
      BigInt(payload.takerAmount) <= 0n ||
      BigInt(payload.makerAmount) * 1000000n >
        BigInt(moneyMicros(preview.limitPrice)) * BigInt(payload.takerAmount) ||
      BigInt(payload.makerAmount) > BigInt(moneyMicros(preview.budget))
    ) {
      throw new PilotError(
        "TRADING_SIGNED_ORDER_INVALID",
        "Signed order does not match the bounded request",
      );
    }
    return { hash, payload };
  }
  async submit(payload: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const client = await this.client();
    signal.throwIfAborted();
    const response = await client.postOrder(payload as SignedOrder);
    if (!response.ok) {
      throw new PilotError(
        "TRADING_ORDER_UNCONFIRMED",
        "Provider did not confirm the order; reconcile before further action",
      );
    }
  }
  async reconcile(order: LiveOrder, signal: AbortSignal): Promise<Reconciliation> {
    if (!order.orderHash) {
      return { status: "unknown" };
    }
    const client = await this.client();
    signal.throwIfAborted();
    // A 404 does not prove a timed-out submission can never arrive. It stays reserved.
    const remote = await client.fetchOrder({ orderId: order.orderHash });
    if (
      remote.makerAddress.toLowerCase() !== this.credentials.wallet.toLowerCase() ||
      remote.tokenId !== order.preview.outcomeId ||
      remote.id.toLowerCase() !== order.orderHash.toLowerCase()
    ) {
      throw new PilotError("TRADING_IDENTITY_CHANGED", "Unexpected provider order identity");
    }
    if (
      ["CANCELED", "CANCELLED", "UNMATCHED"].includes(remote.status.toUpperCase()) &&
      Number(remote.sizeMatched) === 0
    ) {
      return { status: "not_filled" };
    }
    if (Number(remote.sizeMatched) <= 0 || remote.associateTrades.length === 0) {
      return { status: "unknown" };
    }
    if (!Number.isFinite(Number(remote.sizeMatched)) || remote.associateTrades.length > 100) {
      return { status: "unknown" };
    }
    const hashes: string[] = [];
    let shares = 0;
    for (const id of new Set(remote.associateTrades)) {
      signal.throwIfAborted();
      const page = await client.listAccountTrades({ id }).firstPage();
      const trade = page.items.find(
        (t) => t.id === id && t.takerOrderId?.toLowerCase() === order.orderHash!.toLowerCase(),
      );
      if (
        !trade ||
        trade.status !== "CONFIRMED" ||
        !trade.transactionHash ||
        !Number.isFinite(Number(trade.size)) ||
        Number(trade.size) <= 0
      ) {
        return { status: "unknown" };
      }
      hashes.push(trade.transactionHash);
      shares += Number(trade.size);
    }
    if (Math.abs(shares - Number(remote.sizeMatched)) > 0.000001) {
      return { status: "unknown" };
    }
    signal.throwIfAborted();
    const positions = await client
      .listPositions({ user: this.credentials.wallet, pageSize: 100 })
      .firstPage();
    const position = positions.items.find(
      (p) =>
        p.assetId === order.preview.outcomeId &&
        p.wallet.toLowerCase() === this.credentials.wallet.toLowerCase(),
    );
    if (
      !position ||
      !Number.isFinite(Number(position.currentSize)) ||
      Number(position.currentSize) + 0.000001 < shares
    ) {
      return { status: "unknown" };
    }
    // Retain the whole authorized spend as a conservative debit, never invent exact paid fees.
    return {
      status: "settled",
      fill: {
        shares: shares.toFixed(6),
        costUpperBound: order.preview.budget,
        transactionHashes: [...new Set(hashes)],
      },
    };
  }
}
