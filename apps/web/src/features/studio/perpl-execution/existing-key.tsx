"use client";
import { useState } from "react";
import { ActionButton, Field, Icon, Input, Switch } from "@pickler/ui";
import type { PerplLiveExistingKeyDto } from "@pickler/api-schema";
import styles from "./execution.module.css";

export function ExistingPerplKey({
  address,
  disabled,
  connect,
  busy,
}: {
  address: string | null;
  disabled: boolean;
  busy: boolean;
  connect: (input: PerplLiveExistingKeyDto) => Promise<void>;
}) {
  const [useKeyWallet, setUseKeyWallet] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [privateKeyHex, setPrivateKeyHex] = useState("");
  async function submit() {
    const input = { apiKey: apiKey.trim(), privateKeyHex: privateKeyHex.trim(), useKeyWallet };
    setApiKey("");
    setPrivateKeyHex("");
    await connect(input);
  }
  return (
    <details className={styles.copy} open>
      <summary>
        <Icon name="key" size={17} /> Use an existing Perpl key
      </summary>
      <p className={styles.note}>
        Connect your existing Perpl account to this agent. Pickler verifies the wallet from your
        key. This does not deposit funds or start trading.
      </p>
      <Switch checked={useKeyWallet} onCheckedChange={setUseKeyWallet} disabled={disabled}>
        Use this key’s wallet
      </Switch>
      {!useKeyWallet && address ? (
        <p className={styles.note}>The key must match {address}.</p>
      ) : null}
      <Field label="Perpl API key">
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Ed25519 secret · 32-byte hex">
        <Input
          type="password"
          autoComplete="off"
          value={privateKeyHex}
          onChange={(event) => setPrivateKeyHex(event.target.value)}
          disabled={disabled}
        />
      </Field>
      <p className={styles.note}>
        Pickler verifies the wallet and keeps this connection for up to 24 hours. Perpl can expire
        or revoke the key sooner.
      </p>
      <ActionButton
        icon="link"
        state={busy ? "working" : "ready"}
        label={busy ? "Connecting account…" : "Connect existing key"}
        busy={busy}
        disabled={disabled || !apiKey.trim() || !/^(?:0x)?[a-f\d]{64}$/i.test(privateKeyHex.trim())}
        onClick={() => void submit()}
      />
    </details>
  );
}
