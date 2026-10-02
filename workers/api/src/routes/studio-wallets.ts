import * as dto from "@pickler/api-schema";
import { z } from "zod";
import { operation } from "../openapi/operation";
// The studio's wallets modal (docs/specs/studio-create-simplified-v1.md §4.2): the master and every
// agent wallet with their balances read on chain, and transfers of AUSD or MON between the master
// and one of the person's agent wallets, either way. Mounted at /wallets by `studioRoutes`, behind
// its authentication and its error handler, which answers a `WalletRefusal` as
// `{ error, message, detail? }`.

import { Hono } from "hono";
import {
  AgentWalletNotFoundError,
  BalancesUnreadableError,
  DepositFeeTooHighError,
  DepositNonceError,
  DepositNotSendableError,
  DepositsUnavailableError,
  InsufficientFundsError,
  InsufficientGasError,
  InvalidSignedActivityError,
  InvalidTransferError,
  NoCustodyAccountError,
  SignedActivityRejectedError,
  SignedTransactionMismatchError,
  SigningServiceUnavailableError,
  TransferAlreadyRecordedError,
  WalletUnderfundedError,
  type createCustodyService,
  type createStudioAccess,
} from "@pickler/core";
import {
  transferConfirmSchema,
  transferRequestSchema,
  walletsResponseSchema,
} from "@pickler/api-schema";
import type { AppEnv } from "../env";

/** A refusal the wallet routes answer as `{ error, message, detail? }`, in their own words. */
export class WalletRefusal extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500 | 502 | 503,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "WalletRefusal";
  }
}

/**
 * The wallet routes' failures (these routes, and the drafts route's wallet and funding checks).
 * Transfers reuse the deposit's fee, nonce, sendability and availability errors; their callers
 * never moved a deposit, so those answer here with codes and words of their own. The deposit
 * routes keep theirs. Anything else falls through to the studio's mapping.
 */
function walletFailure(error: unknown): WalletRefusal | null {
  if (error instanceof WalletUnderfundedError) {
    return new WalletRefusal(error.code, 409, error.message, error.detail);
  }
  if (error instanceof InvalidTransferError) {
    return new WalletRefusal("INVALID_TRANSFER", 400, error.message);
  }
  if (error instanceof InsufficientFundsError) {
    return new WalletRefusal("INSUFFICIENT_FUNDS", 409, error.message);
  }
  if (error instanceof InsufficientGasError) {
    return new WalletRefusal("INSUFFICIENT_GAS", 409, error.message);
  }
  if (error instanceof TransferAlreadyRecordedError) {
    return new WalletRefusal("TRANSFER_ALREADY_RECORDED", 409, error.message);
  }
  if (error instanceof AgentWalletNotFoundError) {
    return new WalletRefusal("WALLET_NOT_FOUND", 404, "Wallet not found");
  }
  if (error instanceof NoCustodyAccountError) {
    return new WalletRefusal("NO_CUSTODY_ACCOUNT", 409, "Create your passkey wallet first");
  }
  if (error instanceof InvalidSignedActivityError) {
    // Our own check on what the browser stamped; the message says which rule it broke.
    return new WalletRefusal("INVALID_SIGNED_ACTIVITY", 400, error.message);
  }
  if (error instanceof SignedActivityRejectedError) {
    // Turnkey's own words, about the caller's own sub-organization, as the signing family answers.
    return new WalletRefusal("SIGNED_ACTIVITY_REJECTED", 400, error.message);
  }
  if (error instanceof SigningServiceUnavailableError) {
    // Fixed text: this error's message can carry an upstream 5xx body.
    return new WalletRefusal("SIGNING_UNAVAILABLE", 502, "Signing service unavailable");
  }
  if (error instanceof SignedTransactionMismatchError) {
    // Its own code: nothing was broadcast, which the studio may say after the stamp.
    return new WalletRefusal("SIGNED_TX_MISMATCH", 500, "The transfer was not sent");
  }
  if (error instanceof DepositFeeTooHighError) {
    return new WalletRefusal(
      "FEE_TOO_HIGH",
      400,
      "The stamped transaction pays more than twice the current fee",
    );
  }
  if (error instanceof DepositNonceError) {
    return new WalletRefusal("NONCE_GAP", 400, "This transfer is out of date. Prepare it again.");
  }
  if (error instanceof DepositNotSendableError) {
    return new WalletRefusal(
      "NOT_SENDABLE",
      409,
      "The wallet cannot send this transfer. Check its AUSD and MON.",
    );
  }
  if (error instanceof BalancesUnreadableError) {
    // The chain did not answer: an outage, never an underfunded wallet.
    return new WalletRefusal("WALLETS_UNAVAILABLE", 503, error.message);
  }
  if (error instanceof DepositsUnavailableError) {
    return new WalletRefusal(
      "WALLETS_UNAVAILABLE",
      503,
      "Wallets are not available on this deployment",
    );
  }
  return null;
}

/** Runs a wallet route's work, answering its failures in the wallet routes' words. */
export async function walletWork<T>(requestId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SignedTransactionMismatchError) {
      // Turnkey answered a transaction other than the approved one; nothing was broadcast. The
      // message names fields only, never the transaction or key material.
      console.error("Signed transaction mismatch", { requestId, message: error.message });
    }
    throw walletFailure(error) ?? error;
  }
}

/**
 * A decimal amount → base units, exactly: micro-AUSD or wei. Anything but plain digits with an
 * optional fraction ("0x10", "+1", "1e6"), more decimals than the token has, or zero is 400
 * INVALID_TRANSFER.
 */
export function baseUnitsOf(token: "AUSD" | "MON", amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new InvalidTransferError("The amount must be a decimal number");
  }
  const decimals = token === "AUSD" ? 6 : 18;
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new InvalidTransferError(`${token} has at most ${decimals} decimals`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (units <= 0n) {
    throw new InvalidTransferError("The amount must be more than zero");
  }
  return units;
}

const baseUnitStrings = (balance: { monWei: bigint | null; ausdMicro: bigint | null }) => ({
  ausdMicro: balance.ausdMicro === null ? null : balance.ausdMicro.toString(),
  monWei: balance.monWei === null ? null : balance.monWei.toString(),
});

type WalletCustody = Pick<
  ReturnType<typeof createCustodyService>,
  "listWallets" | "prepareTransfer" | "confirmTransfer"
>;

/**
 * `custody` answers the request's custody service, or throws `DepositsUnavailableError` where
 * Turnkey is not composed (503 WALLETS_UNAVAILABLE here). Core checks the wallets are the
 * caller's and rebuilds what was stamped before anything is sent.
 */
export function studioWalletRoutes(deps: {
  access: ReturnType<typeof createStudioAccess>;
  custody: (requestId: string) => WalletCustody;
}) {
  const api = new Hono<AppEnv>();
  const { access } = deps;

  api.get(
    "/",
    operation("studioWallets", {
      security: "user",
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
      description:
        "Verified user and workspace ownership required. Transfers require manage rights and an approved passkey activity.",
      response: dto.walletsResponseSchema,
    }),
    async (c) => {
      const principal = c.get("principal");
      await access.authorize(principal);
      const requestId = c.get("requestId");
      const listed = await walletWork(requestId, async () =>
        deps.custody(requestId).listWallets(principal.id),
      );
      return c.json(
        walletsResponseSchema.parse({
          master: { address: listed.master.address, ...baseUnitStrings(listed.master) },
          agents: listed.agents.map((wallet) => ({
            walletId: wallet.walletId,
            address: wallet.address,
            ...baseUnitStrings(wallet),
            agentId: wallet.agentId,
            agentName: wallet.agentName,
            caps: wallet.caps,
            policiesApproved: wallet.policiesApproved,
          })),
          readAt: listed.readAt,
        }),
      );
    },
  );

  // prepare → passkey stamp in the browser → confirm, which forwards, broadcasts and records.
  api.post(
    "/transfers/prepare",
    operation("studioTransferPrepare", {
      security: "user",
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
      description:
        "Verified user and workspace ownership required. Transfers require manage rights and an approved passkey activity.",
      response: dto.unsignedActivitySchema.extend({ baseUnits: z.string() }),
      body: dto.transferRequestSchema,
    }),
    async (c) => {
      const principal = c.get("principal");
      await access.authorize(principal, true);
      const body = transferRequestSchema.parse(await c.req.json());
      const requestId = c.get("requestId");
      return walletWork(requestId, async () => {
        const amount = baseUnitsOf(body.token, body.amount);
        const unsigned = await deps.custody(requestId).prepareTransfer(principal.id, {
          from: body.from,
          to: body.to,
          token: body.token,
          amount,
        });
        return c.json({
          url: unsigned.url,
          body: unsigned.body,
          timestampMs: unsigned.timestampMs,
          organizationId: unsigned.organizationId,
          baseUnits: amount.toString(),
        });
      });
    },
  );

  api.post(
    "/transfers/confirm",
    operation("studioTransferConfirm", {
      security: "user",
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 401, 403, 404, 409, 500, 502, 503],
      description:
        "Verified user and workspace ownership required. Transfers require manage rights and an approved passkey activity.",
      response: dto.txHashSchema,
      body: dto.transferConfirmSchema,
    }),
    async (c) => {
      const principal = c.get("principal");
      await access.authorize(principal, true);
      const body = transferConfirmSchema.parse(await c.req.json());
      const requestId = c.get("requestId");
      return walletWork(requestId, async () => {
        const { txHash } = await deps.custody(requestId).confirmTransfer(
          principal.id,
          {
            from: body.from,
            to: body.to,
            token: body.token,
            amount: baseUnitsOf(body.token, body.amount),
          },
          body.signed,
        );
        return c.json({ txHash });
      });
    },
  );

  return api;
}
