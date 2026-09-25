/**
 * Funding an agent: AUSD moved from the person's master wallet to the agent's wallet by an ERC-20
 * `transfer`, signed by the passkey (docs/specs/studio-create-and-fund-v1.md §6.2).
 */

/** The amounts the deposit sheet offers, in whole AUSD, as the canvas draws them. */
export const DEPOSIT_AMOUNTS_AUSD = [10, 25, 50, 100] as const;

export type DepositAmountAusd = (typeof DEPOSIT_AMOUNTS_AUSD)[number];

export function isDepositAmount(value: number): value is DepositAmountAusd {
  return (DEPOSIT_AMOUNTS_AUSD as readonly number[]).includes(value);
}

/**
 * The most gas a deposit may reserve. An ERC-20 transfer uses about 50 000; the prepare pads its
 * estimate by a fifth. Monad charges the gas limit rather than the gas used, so a stamped
 * transaction with an inflated limit would burn the person's MON for nothing: it is refused.
 */
export const MAX_DEPOSIT_GAS = 250_000n;

/**
 * How far above a fresh quote a stamped fee may be. Fees move between prepare and confirm, so the
 * stamped ones are not required to match; twice the current quote is room for that movement, and
 * anything above it is a fee nobody prepared.
 */
export const MAX_FEE_MULTIPLE = 2n;

/** The stamped transaction pays a fee far above the chain's current quote (HTTP 400). */
export class DepositFeeTooHighError extends Error {
  constructor() {
    super("The stamped transaction pays more than twice the current fee");
    this.name = "DepositFeeTooHighError";
  }
}

/**
 * The stamped transaction's nonce is not the master wallet's pending nonce (HTTP 400). A lower one
 * can never be mined and a higher one would sit queued behind a gap; only the pending nonce sends.
 * The person prepares again.
 */
export class DepositNonceError extends Error {
  constructor() {
    super("This deposit is out of date. Prepare it again.");
    this.name = "DepositNonceError";
  }
}

/**
 * The transaction Turnkey signed is not the one the passkey approved, or its signer is not the
 * master wallet (HTTP 500). Turnkey answered something unexpected; nothing is broadcast. The
 * message names fields only.
 */
export class SignedTransactionMismatchError extends Error {
  constructor(detail: string) {
    super(`The signed transaction does not match what was approved: ${detail}`);
    this.name = "SignedTransactionMismatchError";
  }
}

/** A deposit amount outside the offered set (HTTP 400). */
export class InvalidDepositAmountError extends Error {
  constructor() {
    super(`A deposit is ${DEPOSIT_AMOUNTS_AUSD.join(", ")} AUSD`);
    this.name = "InvalidDepositAmountError";
  }
}

/**
 * The chain would not accept this transfer from the master wallet — its gas estimate failed,
 * which almost always means the wallet holds too little AUSD or MON (HTTP 409). Never replaced by
 * a guessed gas limit: the person has to learn this before stamping, not after.
 */
export class DepositNotSendableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The master wallet cannot send this deposit. Check its AUSD and MON.", options);
    this.name = "DepositNotSendableError";
  }
}

/** This transaction hash is already recorded as a deposit (HTTP 409). */
export class DepositAlreadyRecordedError extends Error {
  constructor() {
    super("This deposit is already recorded");
    this.name = "DepositAlreadyRecordedError";
  }
}

/** Deposits are not composed on this deployment: no Turnkey or no chain (HTTP 503). */
export class DepositsUnavailableError extends Error {
  constructor() {
    super("Deposits are not available on this deployment");
    this.name = "DepositsUnavailableError";
  }
}
