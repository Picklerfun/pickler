"use client";
import { useState } from "react";
import { Button, Field, Input } from "@pickler/ui";
import type { PerplLiveExistingKeyDto } from "@pickler/api-schema";
import styles from "./execution.module.css";

export function ExistingPerplKey({
  address,
  disabled,
  connect,
}: {
  address: string | null;
  disabled: boolean;
  connect: (input: PerplLiveExistingKeyDto) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [privateKeyHex, setPrivateKeyHex] = useState("");
  async function submit() {
    const input = { apiKey: apiKey.trim(), privateKeyHex: privateKeyHex.trim() };
    setApiKey("");
    setPrivateKeyHex("");
    await connect(input);
  }
  return (
    <details className={styles.copy}>
      <summary>Use an existing Perpl key</summary>
      <p className={styles.note}>
        Connect a read + trade key for this agent&apos;s wallet{address ? ` (${address})` : ""}.
        This does not deposit funds or start trading.
      </p>
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
      <Button
        disabled={disabled || !apiKey.trim() || !/^(?:0x)?[a-f\d]{64}$/i.test(privateKeyHex.trim())}
        onClick={() => void submit()}
      >
        Connect existing key
      </Button>
    </details>
  );
}
