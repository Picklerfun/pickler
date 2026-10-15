/** Only reviewed explanations and RPC codes cross into the UI; provider payloads stay private. */
export interface WalletFailure {
  title: string;
  hint: string;
  detail: string;
  method: string;
  code: number | null;
}

function errorEntries(error: unknown): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length && entries.length < 12) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const entry = value as Record<string, unknown>;
    entries.push(entry);
    pending.push(entry.cause, entry.error, entry.originalError, entry.data);
  }
  return entries;
}

export function walletErrorCode(error: unknown): number | null {
  const entries = errorEntries(error);
  const codes = entries.flatMap((entry) => {
    const raw = entry.code;
    if (typeof raw !== "number" && !(typeof raw === "string" && /^-?\d{1,10}$/.test(raw))) {
      return [];
    }
    const code = Number(raw);
    return Number.isSafeInteger(code) ? [code] : [];
  });
  return codes.find((code) => code !== -32603 && code !== 0) ?? codes[0] ?? null;
}

export function walletFailure(error: unknown, method: string): WalletFailure {
  if (error instanceof WalletRequestError) {
    return error.failure;
  }
  const code = walletErrorCode(error);
  const message = errorEntries(error)
    .map((entry) => (typeof entry.message === "string" ? entry.message.slice(0, 1000) : ""))
    .join(" ")
    .toLowerCase();
  const network = method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain";
  let title = network ? "Network change failed" : "Wallet request failed";
  let hint = network ? "Choose Monad testnet in your wallet" : "Open your wallet and try again";
  let detail = network
    ? "The wallet did not confirm Monad testnet. Select it in the wallet's network settings, then try again."
    : "The wallet could not complete this request. Open the extension to check its connection and network.";
  if (code === 4001) {
    title = "Request cancelled";
    hint = "Nothing new was sent";
    detail = "The wallet declined or closed this request. Your entered amount is kept.";
  } else if (code === -32002) {
    title = "Wallet request already open";
    hint = "Finish the request in your wallet";
    detail =
      "Your wallet already has a pending request. Open the extension and approve or dismiss it before retrying.";
  } else if (code === 4100) {
    title = "Wallet access expired";
    hint = "Reconnect this wallet";
    detail =
      "This wallet no longer authorizes Pickler to use the selected account. Disconnect and reconnect it.";
  } else if (code === 4900 || code === 4901) {
    title = "Wallet network disconnected";
    hint = "Check your wallet's RPC connection";
    detail =
      "The extension cannot reach the requested network. Check its connection to Monad testnet before retrying.";
  } else if (
    code === 4902 ||
    /unsupported chain|chain.*not supported|unrecognized chain/.test(message)
  ) {
    title = "Monad testnet is not available";
    hint = "Enable Monad testnet in your wallet";
    detail =
      "Enable or add Monad testnet (chain 10143) in the wallet's network settings, then select it. The app has not confirmed the network change.";
  } else if (/insufficient funds|not enough.*gas/.test(message)) {
    title = "Not enough MON for gas";
    hint = "Add testnet MON to this wallet";
    detail =
      "The wallet reported insufficient funds for the transaction and gas. The connected wallet needs MON on Monad testnet.";
  } else if (code === 4200 || code === -32601) {
    title = network ? "Network switching unavailable" : "Wallet method unsupported";
    hint = network ? "Select Monad testnet in your wallet" : "Update or reconnect the extension";
    detail = network
      ? "This wallet does not support this network-switch request. Select Monad testnet directly in the extension."
      : "The wallet does not support the requested method. Update the extension or reconnect a supported browser wallet.";
  } else if (/execution reverted|revert/.test(message)) {
    title = "Trade simulation failed";
    hint = "Refresh the quote and check your balance";
    detail =
      "The contract refused the wallet's simulation. Check your token balance and the latest minimum received before preparing again.";
  } else if (code === -32602) {
    title = "Wallet rejected the parameters";
    hint = "Prepare a fresh quote";
    detail =
      "The wallet rejected the transaction parameters. Prepare a new quote on Monad testnet; no automatic send will be attempted.";
  } else if (/nonce|wallet activity changed/.test(message)) {
    title = "Wallet activity changed";
    hint = "Prepare a fresh quote";
    detail =
      "Another transaction changed this wallet's nonce. Prepare again to use its current state.";
  } else if (/account or network changed|connect.*monad|network did not change/.test(message)) {
    title = "Check your wallet network";
    hint = "Select the same account on Monad testnet";
    detail =
      "The wallet account or network no longer matches this trade. Select the connected account and Monad testnet before preparing again.";
  } else if (/prepared transaction|unexpected.*(target|approval|swap)|quote.*match/.test(message)) {
    title = "Trade needs a fresh quote";
    hint = "Prepare again before signing";
    detail =
      "The prepared trade is expired or no longer matches this wallet and token. It was not sent.";
  }
  return { title, hint, detail, code, method };
}

export class WalletRequestError extends Error {
  readonly failure: WalletFailure;
  readonly code: number | null;
  constructor(error: unknown, method: string) {
    const failure = walletFailure(error, method);
    super(failure.detail);
    this.failure = failure;
    this.code = failure.code;
  }
}
