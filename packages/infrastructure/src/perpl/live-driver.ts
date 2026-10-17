import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseTransaction,
  recoverTypedDataAddress,
  serializeTransaction,
  toFunctionSelector,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { AUSD, IPerplExchangeAbi, requireSupportedChain } from "@pickler/chain";
import {
  InvalidSignedActivityError,
  PilotError,
  type SignedActivityForwarder,
  type TurnkeyReader,
  type TurnkeyActivity,
  type UnsignedActivity,
} from "@pickler/core";
import type {
  PerplLiveAuthority,
  PerplLiveDocument,
  PerplLiveDriver,
  PerplLiveOrderEvidence,
  PerplLivePosition,
  PerplLiveSetup,
} from "@pickler/trading/perpl-live";
import { parseContext } from "@pickler/perpl-context";
import { z } from "zod";
import { createActivityBuilders } from "../turnkey/turnkey-activities.js";
import { createJsonRpc, JsonRpcError } from "../chain/erc20.js";
import {
  broadcastTransaction,
  pendingNonce,
  quoteFees,
  transactionHash,
  verifySignedTransfer,
} from "../chain/deposit-tx.js";
import { createPerplKeyVault, perplBase64, perplBytes, perplHex } from "./key-vault.js";
import { createPerplTradingHttp, perplKeyBinding } from "./trading-http.js";

export const perplLivePolicySchema = z
  .object({
    version: z.literal(1),
    chainId: z.literal(10143),
    exchange: z.string().regex(/^0x[a-f\d]{40}$/i),
    exchangeCodeHash: z.string().regex(/^0x[a-f\d]{64}$/i),
    exchangeImplementation: z
      .object({
        address: z.string().regex(/^0x[a-f\d]{40}$/i),
        codeHash: z.string().regex(/^0x[a-f\d]{64}$/i),
      })
      .strict()
      .optional(),
    enrollmentOrigin: z.string().url(),
    rpcUrl: z.string().url(),
    maxCollateralMicros: z.string().regex(/^[1-9]\d{0,23}$/),
    maxGas: z.number().int().min(21000).max(500000),
    maxFeePerGasWei: z.string().regex(/^[1-9]\d{0,23}$/),
    maxSlippageBps: z.number().int().min(1).max(1000),
  })
  .strict();
export type PerplLivePolicy = z.infer<typeof perplLivePolicySchema>;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.string().regex(/^-?\d{1,60}$/);
const at = z.object({
  b: integer.optional(),
  t: integer.optional(),
  txid: z
    .string()
    .regex(/^(?:0x)?[a-f\d]{64}$/i)
    .transform((hash) => `0x${hash.replace(/^0x/i, "").toLowerCase()}`)
    .optional(),
  l: integer.optional(),
});
const venueOrder = z.object({
  lv: integer,
  rq: integer,
  acc: integer,
  mkt: integer,
  oid: integer,
  t: integer,
  st: integer,
  os: integer,
  fs: integer,
  fp: integer,
  f: amount,
  at: at,
  c: at.optional(),
});
const venuePosition = z.object({
  pid: integer,
  rq: integer,
  acc: integer,
  mkt: integer,
  sd: z.union([z.literal(1), z.literal(2)]),
  st: integer,
  sr: integer,
  s: integer,
  ep: integer,
  c: amount,
  lv: integer,
  fee: amount,
  dpnl: amount.optional(),
  fnd: amount.optional(),
  xp: integer.optional(),
  at: at,
});
const positionPage = z.object({ d: z.array(venuePosition).max(1000) });
function position(p: z.infer<typeof venuePosition>): PerplLivePosition {
  return {
    requestId: p.rq,
    id: p.pid,
    marketId: p.mkt,
    side: p.sd === 1 ? "long" : "short",
    size: p.s,
    entryPrice: p.ep,
    collateralMicros: p.c,
    leverage: p.lv,
    feeMicros: p.fee,
    realizedPnlMicros: p.dpnl ?? null,
    fundingMicros: p.fnd ?? null,
    exitPrice: p.xp ?? null,
    closed: p.st !== 1,
  };
}
function order(o: z.infer<typeof venueOrder>): PerplLiveOrderEvidence {
  let status: PerplLiveOrderEvidence["status"] = "pending";
  if (o.st === 4) {
    status = "filled";
  } else if ([5, 6, 7].includes(o.st)) {
    status = o.fs > 0 ? "partial" : o.st === 5 ? "cancelled" : o.st === 6 ? "expired" : "rejected";
  }
  return {
    originalSize: o.os,
    leverage: o.lv,
    requestId: o.rq,
    accountId: o.acc,
    marketId: o.mkt,
    orderId: o.oid,
    type: o.t,
    status,
    filledSize: o.fs,
    fillPrice: o.fp,
    feeMicros: o.f,
    txHashes: [...new Set([o.at.txid, o.c?.txid].filter((x): x is string => !!x))],
  };
}
export function createPerplLiveDriver(config: {
  policy: PerplLivePolicy;
  encryptionKey: string;
  forwarder?: SignedActivityForwarder;
  reader?: TurnkeyReader;
  transport?: typeof fetch;
  requestMembership?: (
    scope: PerplLiveAuthority["scope"],
    requests: number[],
  ) => Promise<{ requestId: number; orderType: number; sessionId: string }[]>;
}): PerplLiveDriver {
  const policy = perplLivePolicySchema.parse(config.policy);
  const vault = createPerplKeyVault(config.encryptionKey);
  const http = createPerplTradingHttp(vault, config.transport);
  const rpc = createJsonRpc(policy.rpcUrl, config.transport);
  const collateral = AUSD[requireSupportedChain(10143)];
  const activities = createActivityBuilders();
  async function context() {
    const raw = await http.request("/v1/pub/context");
    const parsed = parseContext(raw);
    const wire = z
      .object({
        chain: z.object({ chain_id: z.literal(10143) }),
        instances: z.array(
          z.object({ id: integer, address: z.string(), collateral_token_id: integer }),
        ),
        tokens: z.array(z.object({ id: integer, address: z.string(), decimals: integer })),
      })
      .parse(raw);
    const instance = wire.instances.find(
      (i) => i.address.toLowerCase() === policy.exchange.toLowerCase(),
    );
    const token = wire.tokens.find((t) => t.id === instance?.collateral_token_id);
    if (
      !instance ||
      parsed.instance.exchange.toLowerCase() !== policy.exchange.toLowerCase() ||
      token?.address.toLowerCase() !== collateral.address.toLowerCase() ||
      token.decimals !== 6
    ) {
      throw new PilotError(
        "PERPL_BINDINGS_CHANGED",
        "Perpl exchange or collateral identity changed",
      );
    }
    return { ...parsed, instance: { ...parsed.instance, id: instance.id } };
  }
  async function chainGuard() {
    if (BigInt(String(await rpc.call("eth_chainId", []))) !== 10143n) {
      throw new PilotError("PERPL_TESTNET_ONLY", "RPC network mismatch");
    }
    const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    const block = policy.exchangeImplementation
      ? String(await rpc.call("eth_blockNumber", []))
      : "latest";
    const code = await rpc.call("eth_getCode", [policy.exchange, block]);
    if (
      typeof code !== "string" ||
      !/^0x[\da-f]+$/i.test(code) ||
      keccak256(code as Hex).toLowerCase() !== policy.exchangeCodeHash.toLowerCase()
    ) {
      throw new PilotError("PERPL_BINDINGS_CHANGED", "Perpl exchange bytecode changed");
    }
    if (!policy.exchangeImplementation) {
      if (code.toLowerCase().includes(implementationSlot.slice(2))) {
        throw new PilotError(
          "PERPL_BINDINGS_CHANGED",
          "Perpl proxy implementation is not reviewed",
        );
      }
      return;
    }
    const implementation = await rpc.call("eth_getStorageAt", [
      policy.exchange,
      implementationSlot,
      block,
    ]);
    if (
      typeof implementation !== "string" ||
      !/^0x0{24}[\da-f]{40}$/i.test(implementation) ||
      `0x${implementation.slice(-40)}`.toLowerCase() !==
        policy.exchangeImplementation.address.toLowerCase()
    ) {
      throw new PilotError("PERPL_BINDINGS_CHANGED", "Perpl proxy implementation changed");
    }
    const implementationCode = await rpc.call("eth_getCode", [
      policy.exchangeImplementation.address,
      block,
    ]);
    if (
      typeof implementationCode !== "string" ||
      !/^0x[\da-f]+$/i.test(implementationCode) ||
      keccak256(implementationCode as Hex).toLowerCase() !==
        policy.exchangeImplementation.codeHash.toLowerCase()
    ) {
      throw new PilotError("PERPL_BINDINGS_CHANGED", "Perpl implementation bytecode changed");
    }
  }
  async function accountId(address: string) {
    const data =
      toFunctionSelector("getAccountByAddr(address)") +
      address.slice(2).toLowerCase().padStart(64, "0");
    try {
      const value = await rpc.call("eth_call", [{ to: policy.exchange, data }, "latest"]);
      if (typeof value !== "string" || !/^0x[\da-f]{64,}$/i.test(value)) {
        throw new Error();
      }
      const id = BigInt("0x" + value.slice(2, 66));
      if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error();
      }
      return Number(id);
    } catch (error) {
      if (error instanceof JsonRpcError && error.code === 3) {
        return 0;
      }
      throw new PilotError("PERPL_ACCOUNT_UNAVAILABLE", "Could not read the exchange account");
    }
  }
  async function transaction(
    authority: PerplLiveAuthority,
    to: Hex,
    data: Hex,
  ): Promise<{ activity: UnsignedActivity; unsignedTransaction: Hex }> {
    await chainGuard();
    const nonce = await pendingNonce(rpc, authority.address);
    const fees = await quoteFees(rpc, BigInt(policy.maxFeePerGasWei));
    const estimate = BigInt(
      String(
        await rpc.call("eth_estimateGas", [{ from: authority.address, to, data, value: "0x0" }]),
      ),
    );
    const gas = (estimate * 12n + 9n) / 10n;
    if (gas > BigInt(policy.maxGas)) {
      throw new PilotError("PERPL_GAS_LIMIT", "Account transaction exceeds its gas ceiling");
    }
    const unsignedTransaction = serializeTransaction({
      type: "eip1559",
      chainId: 10143,
      nonce,
      to,
      data,
      value: 0n,
      gas,
      ...fees,
    });
    return {
      unsignedTransaction,
      activity: activities.signTransaction({
        subOrganizationId: authority.organizationId,
        signWith: getAddress(authority.address),
        unsignedTransaction,
      }),
    };
  }
  function preparation(value: unknown) {
    return z
      .object({
        unsignedTransaction: z.string().optional(),
        typedData: z.record(z.string(), z.unknown()).optional(),
        mac: z.string().optional(),
        kind: z.string(),
        amountMicros: z.string(),
        accountId: integer,
        expiresAt: integer.optional(),
        signedTransaction: z.string().optional(),
        enrollmentAttempted: z.boolean().optional(),
      })
      .parse(value);
  }
  function checkPreparedTransaction(setup: PerplLiveSetup) {
    const prepared = preparation(setup.privatePreparation);
    if (
      !prepared.unsignedTransaction ||
      prepared.amountMicros !== setup.amountMicros ||
      BigInt(prepared.amountMicros) > BigInt(policy.maxCollateralMicros)
    ) {
      throw new InvalidSignedActivityError("Prepared collateral terms changed");
    }
    const tx = parseTransaction(prepared.unsignedTransaction as Hex);
    let expected: Hex;
    if (setup.kind === "approve") {
      expected = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [policy.exchange as Hex, BigInt(prepared.amountMicros)],
      });
    } else if (setup.kind === "create_account") {
      expected = encodeFunctionData({
        abi: IPerplExchangeAbi,
        functionName: "createAccount",
        args: [BigInt(prepared.amountMicros)],
      });
    } else if (setup.kind === "deposit") {
      expected = encodeFunctionData({
        abi: IPerplExchangeAbi,
        functionName: "depositCollateral",
        args: [BigInt(prepared.amountMicros)],
      });
    } else if (setup.kind === "forwarding") {
      expected = encodeFunctionData({
        abi: IPerplExchangeAbi,
        functionName: "allowOrderForwarding",
        args: [true],
      });
    } else {
      throw new InvalidSignedActivityError("Unsupported owner transaction");
    }
    const target = setup.kind === "approve" ? collateral.address : policy.exchange;
    if (
      tx.to?.toLowerCase() !== target.toLowerCase() ||
      tx.data?.toLowerCase() !== expected.toLowerCase() ||
      tx.type !== "eip1559" ||
      tx.chainId !== 10143 ||
      (tx.value ?? 0n) !== 0n ||
      !tx.gas ||
      tx.gas > BigInt(policy.maxGas) ||
      !tx.maxFeePerGas ||
      tx.maxFeePerGas > BigInt(policy.maxFeePerGasWei)
    ) {
      throw new InvalidSignedActivityError(
        "Owner transaction no longer matches the reviewed policy",
      );
    }
    return tx;
  }
  function typedPayload(
    raw: unknown,
    authority: PerplLiveAuthority,
    publicKey: string,
    expiresAt: number,
    maxAge = 30_000,
  ) {
    const schema = z
      .object({
        types: z.record(
          z.string(),
          z.array(z.object({ name: z.string(), type: z.string() }).strict()).max(15),
        ),
        primaryType: z.literal("PerplRegisterApiKey"),
        domain: z
          .object({
            name: z.literal("perpl.xyz"),
            version: z.literal("1"),
            chainId: z.union([z.string(), z.number()]),
            verifyingContract: z.literal("0x0000000000000000000000000000000000000000"),
            salt: z.string().regex(/^0x[a-f\d]{64}$/i),
          })
          .strict(),
        message: z
          .object({
            signer: z.string(),
            statement: z.literal(
              "I authorize the creation of Perpl API key with the specified scope and parameters",
            ),
            publicKey: z.string(),
            scope: z.literal("3"),
            label: z.literal("Pickler Studio"),
            expiresAt: z.string(),
            ipCidrs: z.literal(""),
            origin: z.literal(policy.enrollmentOrigin),
            builderId: z.literal("0"),
            maxBuilderFeePer100K: z.literal("0"),
            time: z.union([z.string(), z.number()]),
          })
          .strict(),
      })
      .strict();
    const parsed = schema.parse(raw);
    const fields = [
      { name: "signer", type: "address" },
      { name: "statement", type: "string" },
      { name: "publicKey", type: "string" },
      { name: "scope", type: "string" },
      { name: "label", type: "string" },
      { name: "expiresAt", type: "string" },
      { name: "ipCidrs", type: "string" },
      { name: "origin", type: "string" },
      { name: "builderId", type: "string" },
      { name: "maxBuilderFeePer100K", type: "string" },
      { name: "time", type: "uint64" },
    ];
    const domainFields = [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
    ];
    if (
      Object.keys(parsed.types).length !== 2 ||
      JSON.stringify(parsed.types.PerplRegisterApiKey) !== JSON.stringify(fields) ||
      JSON.stringify(parsed.types.EIP712Domain) !== JSON.stringify(domainFields) ||
      BigInt(parsed.domain.chainId) !== 10143n ||
      parsed.message.signer.toLowerCase() !== authority.address ||
      parsed.message.publicKey !== perplBase64(perplBytes(publicKey.slice(2))) ||
      BigInt(parsed.message.expiresAt) !== BigInt(expiresAt) ||
      Math.abs(Number(BigInt(parsed.message.time)) - Date.now()) > maxAge
    ) {
      throw new PilotError(
        "PERPL_ENROLLMENT_MISMATCH",
        "Enrollment does not match this agent's reviewed trading permission",
      );
    }
    // The exact domain and every field/type above were checked before this SDK boundary.
    return {
      ...parsed,
      domain: { ...parsed.domain, chainId: 10143 },
      message: { ...parsed.message, time: BigInt(parsed.message.time) },
    } as unknown as TypedDataDefinition;
  }
  async function finishActivity(
    authority: PerplLiveAuthority,
    document: PerplLiveDocument,
    setup: PerplLiveSetup,
    result: TurnkeyActivity,
    guard: () => Promise<void>,
    progress: (change: { txHash?: string; privatePreparation?: unknown }) => Promise<void>,
  ) {
    const prepared = preparation(setup.privatePreparation);
    const original = JSON.parse(setup.activity!.body) as { type: string };
    if (
      (setup.activityId && result.id !== setup.activityId) ||
      result.organizationId !== authority.organizationId ||
      result.type !== original.type
    ) {
      throw new PilotError("PERPL_ACTIVITY_MISMATCH", "Signing activity identity changed");
    }
    if (result.status !== "ACTIVITY_STATUS_COMPLETED") {
      return { activityId: result.id, status: "pending" as const };
    }
    if (prepared.unsignedTransaction) {
      checkPreparedTransaction(setup);
      const raw = result.result?.signTransactionResult?.signedTransaction;
      if (typeof raw !== "string") {
        return { activityId: result.id, status: "pending" as const };
      }
      await verifySignedTransfer({
        signedTransaction: raw,
        unsignedTransaction: prepared.unsignedTransaction,
        signer: authority.address,
      });
      const hash = transactionHash(raw);
      await progress({ txHash: hash, privatePreparation: { ...prepared, signedTransaction: raw } });
      await guard();
      await broadcastTransaction(rpc, raw);
      return {
        activityId: result.id,
        status: "submitted" as const,
        txHash: hash,
        ...(prepared.accountId ? { accountId: prepared.accountId } : {}),
      };
    }
    // Enrollment returns its token only once. Never repeat a possibly delivered enrollment POST.
    if (prepared.enrollmentAttempted) {
      return { activityId: result.id, status: "pending" as const };
    }
    const td = typedPayload(
      prepared.typedData,
      authority,
      document.publicKey!,
      prepared.expiresAt!,
      300_000,
    );
    const raw = result.result?.signRawPayloadResult;
    if (
      !raw ||
      typeof raw.r !== "string" ||
      typeof raw.s !== "string" ||
      typeof raw.v !== "string"
    ) {
      return { activityId: result.id, status: "pending" as const };
    }
    const v = parseInt(raw.v.replace(/^0x/, ""), 16);
    const signature =
      "0x" +
      raw.r.replace(/^0x/, "").padStart(64, "0") +
      raw.s.replace(/^0x/, "").padStart(64, "0") +
      (v < 27 ? v + 27 : v).toString(16).padStart(2, "0");
    if (
      (await recoverTypedDataAddress({ ...td, signature: signature as Hex })).toLowerCase() !==
      authority.address
    ) {
      throw new PilotError("PERPL_SIGNER_MISMATCH", "Enrollment signer changed");
    }
    const bytes = perplBytes(
      await vault.open(document.encryptedKey!, perplKeyBinding(document, "private")),
    );
    let pop: string;
    try {
      const key = await crypto.subtle.importKey("pkcs8", bytes, "Ed25519", false, ["sign"]);
      pop =
        "0x" +
        perplHex(
          new Uint8Array(
            await crypto.subtle.sign("Ed25519", key, new Uint8Array(hexToBytes(hashTypedData(td)))),
          ),
        );
    } finally {
      bytes.fill(0);
    }
    await guard();
    await progress({ privatePreparation: { ...prepared, enrollmentAttempted: true } });
    const enrolled = z
      .object({
        api_key: z.object({
          api_key: z.string().min(1),
          address: z.string(),
          scope_mask: z.literal(3),
          expires_at: integer,
        }),
      })
      .parse(
        await http.request("/v1/api-key/enroll", {
          method: "POST",
          origin: policy.enrollmentOrigin,
          body: {
            chain_id: 10143,
            address: authority.address,
            typed_data: prepared.typedData,
            mac: prepared.mac,
            signature,
            pop_signature: pop,
          },
        }),
      );
    if (
      enrolled.api_key.address.toLowerCase() !== authority.address ||
      enrolled.api_key.expires_at !== prepared.expiresAt
    ) {
      throw new PilotError("PERPL_KEY_MISMATCH", "Enrollment key identity changed");
    }
    return {
      activityId: result.id,
      status: "confirmed" as const,
      accountId: prepared.accountId,
      encryptedToken: await vault.seal(
        enrolled.api_key.api_key,
        perplKeyBinding(document, "token"),
      ),
    };
  }
  const driver: PerplLiveDriver = {
    async requirements() {
      const ctx = await context();
      return {
        minimumAccountMicros: ctx.instance.minAccountOpen.toString(),
        minimumDepositMicros: ctx.instance.minDeposit.toString(),
        maximumCollateralMicros: policy.maxCollateralMicros,
      };
    },
    async connectExistingKey(authority, document, input, validUntil) {
      await chainGuard();
      const seed = perplBytes(input.privateKeyHex.replace(/^0x/i, ""));
      const prefix = perplBytes("302e020100300506032b657004220420");
      const privateBytes = new Uint8Array(prefix.length + seed.length);
      privateBytes.set(prefix);
      privateBytes.set(seed, prefix.length);
      seed.fill(0);
      try {
        const key = await crypto.subtle.importKey("pkcs8", privateBytes, "Ed25519", true, ["sign"]);
        const jwk = await crypto.subtle.exportKey("jwk", key);
        if (!jwk.x) {
          throw new PilotError("PERPL_CREDENTIAL_INVALID", "Could not validate the trading key");
        }
        const rawPublic = Uint8Array.from(
          atob(jwk.x.replaceAll("-", "+").replaceAll("_", "/")),
          (value) => value.charCodeAt(0),
        );
        const publicKey = "0x" + perplHex(rawPublic);
        let address = authority.address;
        const binding = {
          productAgentId: document.productAgentId,
          address,
          publicKey,
        };
        if (input.useKeyWallet) {
          const discovery = {
            ...document,
            ...binding,
            encryptedKey: await vault.seal(
              perplHex(privateBytes),
              perplKeyBinding(binding, "private"),
            ),
            encryptedToken: await vault.seal(input.apiKey, perplKeyBinding(binding, "token")),
          };
          const wallet = z
            .object({ addr: z.string().regex(/^0x[a-f\d]{40}$/i) })
            .parse(await http.request("/v1/trading/wallet", { document: discovery }));
          address = wallet.addr.toLowerCase();
          binding.address = address;
        }
        const id = await accountId(address);
        if (!id) {
          throw new PilotError("PERPL_ACCOUNT_REQUIRED", "This wallet has no Perpl account");
        }
        const encryptedKey = await vault.seal(
          perplHex(privateBytes),
          perplKeyBinding(binding, "private"),
        );
        const encryptedToken = await vault.seal(input.apiKey, perplKeyBinding(binding, "token"));
        const candidate = {
          ...document,
          address,
          accountId: id,
          publicKey,
          encryptedKey,
          encryptedToken,
          keyExpiresAt: validUntil,
        };
        const snapshot = await driver.snapshot({ ...authority, address }, candidate);
        if (snapshot.frozen || !snapshot.forwarding) {
          throw new PilotError(
            "PERPL_FORWARDING_REQUIRED",
            "Enable trading for this wallet's Perpl account first",
          );
        }
        return { address, accountId: id, publicKey, encryptedKey, encryptedToken, snapshot };
      } catch (error) {
        if (error instanceof PilotError) {
          throw error;
        }
        if (error instanceof z.ZodError) {
          throw new PilotError("PERPL_RESPONSE_INVALID", "Perpl returned invalid account data");
        }
        throw new PilotError("PERPL_CREDENTIAL_INVALID", "Could not validate the trading key");
      } finally {
        privateBytes.fill(0);
      }
    },
    async prepareSetup(authority, document, amountMicros) {
      if (!config.forwarder || !config.reader) {
        throw new PilotError("PERPL_SIGNING_UNAVAILABLE", "Owner signing is not configured");
      }
      const amount = BigInt(amountMicros);
      if (amount <= 0n || amount > BigInt(policy.maxCollateralMicros)) {
        throw new PilotError(
          "PERPL_COLLATERAL_LIMIT",
          "Collateral exceeds the reviewed testnet limit",
        );
      }
      const ctx = await context();
      const id = await accountId(authority.address);
      if (!id) {
        if (amount < ctx.instance.minAccountOpen) {
          throw new PilotError(
            "PERPL_COLLATERAL_MINIMUM",
            `Perpl requires at least ${ctx.instance.minAccountOpen / 1_000_000n} AUSD of collateral`,
          );
        }
        const allowance = await rpc.call("eth_call", [
          {
            to: collateral.address,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "allowance",
              args: [authority.address as Hex, policy.exchange as Hex],
            }),
          },
          "latest",
        ]);
        const kind =
          BigInt(String(allowance)) < amount ? ("approve" as const) : ("create_account" as const);
        const to = kind === "approve" ? collateral.address : (policy.exchange as Hex);
        const data =
          kind === "approve"
            ? encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [policy.exchange as Hex, amount],
              })
            : encodeFunctionData({
                abi: IPerplExchangeAbi,
                functionName: "createAccount",
                args: [amount],
              });
        const tx = await transaction(authority, to, data);
        return {
          kind,
          activity: tx.activity,
          privatePreparation: {
            kind,
            amountMicros,
            accountId: 0,
            unsignedTransaction: tx.unsignedTransaction,
          },
        };
      }
      const forwardingDone = document.setup.some(
        (s) => s.kind === "forwarding" && s.status === "confirmed",
      );
      if (!forwardingDone) {
        const tx = await transaction(
          authority,
          policy.exchange as Hex,
          encodeFunctionData({
            abi: IPerplExchangeAbi,
            functionName: "allowOrderForwarding",
            args: [true],
          }),
        );
        return {
          kind: "forwarding",
          activity: tx.activity,
          privatePreparation: {
            kind: "forwarding",
            amountMicros,
            accountId: id,
            unsignedTransaction: tx.unsignedTransaction,
          },
        };
      }
      if (document.encryptedToken && document.keyExpiresAt && document.keyExpiresAt > Date.now()) {
        if (amount < ctx.instance.minDeposit) {
          throw new PilotError("PERPL_COLLATERAL_MINIMUM", "The deposit is below Perpl's minimum");
        }
        const allowance = await rpc.call("eth_call", [
          {
            to: collateral.address,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "allowance",
              args: [authority.address as Hex, policy.exchange as Hex],
            }),
          },
          "latest",
        ]);
        const kind =
          BigInt(String(allowance)) < amount ? ("approve" as const) : ("deposit" as const);
        const data =
          kind === "approve"
            ? encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [policy.exchange as Hex, amount],
              })
            : encodeFunctionData({
                abi: IPerplExchangeAbi,
                functionName: "depositCollateral",
                args: [amount],
              });
        const tx = await transaction(
          authority,
          kind === "approve" ? collateral.address : (policy.exchange as Hex),
          data,
        );
        return {
          kind,
          activity: tx.activity,
          privatePreparation: {
            kind,
            amountMicros,
            accountId: id,
            unsignedTransaction: tx.unsignedTransaction,
          },
        };
      }
      const pair = (await crypto.subtle.generateKey("Ed25519", true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const publicKey =
        "0x" + perplHex(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
      const rawKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
      const expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000;
      const binding = {
        productAgentId: authority.scope.productAgentId,
        address: authority.address,
        publicKey,
      };
      const encryptedKey = await vault.seal(perplHex(rawKey), perplKeyBinding(binding, "private"));
      rawKey.fill(0);
      const response = z
        .object({ typed_data: z.record(z.string(), z.unknown()), mac: z.string().min(1) })
        .parse(
          await http.request("/v1/api-key/payload", {
            method: "POST",
            origin: policy.enrollmentOrigin,
            body: {
              chain_id: 10143,
              address: authority.address,
              public_key: publicKey,
              scope_mask: 3,
              label: "Pickler Studio",
              expires_at: expiresAt,
            },
          }),
        );
      const typedData = typedPayload(response.typed_data, authority, publicKey, expiresAt);
      const timestampMs = String(Date.now());
      const activity: UnsignedActivity = {
        url: "https://api.turnkey.com/public/v1/submit/sign_raw_payload",
        organizationId: authority.organizationId,
        timestampMs,
        body: JSON.stringify({
          type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
          timestampMs,
          organizationId: authority.organizationId,
          parameters: {
            signWith: getAddress(authority.address),
            payload: hashTypedData(typedData).slice(2),
            encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
            hashFunction: "HASH_FUNCTION_NO_OP",
          },
        }),
      };
      return {
        kind: "enroll",
        activity,
        privatePreparation: {
          kind: "enroll",
          amountMicros,
          accountId: id,
          typedData: response.typed_data,
          mac: response.mac,
          expiresAt,
        },
        key: { publicKey, encryptedKey, expiresAt },
      };
    },
    async confirmSetup(authority, document, setup, signed, guard, progress) {
      if (!config.forwarder || !setup.activity || setup.createdAt + 300_000 < Date.now()) {
        throw new InvalidSignedActivityError("Perpl preparation expired or signing unavailable");
      }
      const original = JSON.parse(setup.activity.body) as Record<string, unknown>;
      const presented = JSON.parse(signed.body) as { timestampMs?: unknown };
      if (
        signed.stamp.stampHeaderName.toLowerCase() !== "x-stamp-webauthn" ||
        typeof presented.timestampMs !== "string" ||
        !/^\d+$/.test(presented.timestampMs) ||
        Math.abs(Number(presented.timestampMs) - Date.now()) > 30_000 ||
        signed.url !== setup.activity.url ||
        signed.body !== JSON.stringify({ ...original, timestampMs: presented.timestampMs })
      ) {
        throw new InvalidSignedActivityError(
          "The signed activity differs from this agent's preparation",
        );
      }
      const prepared = preparation(setup.privatePreparation);
      if (prepared.typedData) {
        typedPayload(
          prepared.typedData,
          authority,
          document.publicKey!,
          prepared.expiresAt!,
          300_000,
        );
      }
      await chainGuard();
      if (prepared.unsignedTransaction) {
        const tx = checkPreparedTransaction(setup);
        const fees = await quoteFees(rpc, BigInt(policy.maxFeePerGasWei));
        const nonce = await pendingNonce(rpc, authority.address);
        if (
          tx.chainId !== 10143 ||
          (tx.value ?? 0n) !== 0n ||
          tx.gas! > BigInt(policy.maxGas) ||
          tx.maxFeePerGas! > fees.maxFeePerGas * 2n ||
          tx.maxPriorityFeePerGas! > fees.maxPriorityFeePerGas * 2n ||
          tx.nonce !== nonce
        ) {
          throw new InvalidSignedActivityError(
            "Prepared transaction is no longer within its approved bounds",
          );
        }
        await rpc.call("eth_estimateGas", [
          { from: authority.address, to: tx.to, data: tx.data, value: "0x0" },
        ]);
      }
      await guard();
      const result = await config.forwarder.forward(signed, {
        organizationId: authority.organizationId,
        allowedActivityTypes: [String(original.type)],
      });
      if (
        !result.id ||
        result.organizationId !== authority.organizationId ||
        result.type !== original.type
      ) {
        throw new Error("PERPL_ACTIVITY_MISMATCH");
      }
      await progress({ activityId: result.id });
      return finishActivity(authority, document, setup, result, guard, progress);
    },
    async reconcileSetup(authority, document, setup, guard, progress) {
      await chainGuard();
      if (!setup.txHash && setup.activityId && config.reader) {
        const result = await config.reader.getActivity(authority.organizationId, setup.activityId);
        if (
          result.id !== setup.activityId ||
          result.organizationId !== authority.organizationId ||
          result.type !== JSON.parse(setup.activity!.body).type
        ) {
          throw new PilotError("PERPL_ACTIVITY_MISMATCH", "Signing activity identity changed");
        }
        if (["ACTIVITY_STATUS_FAILED", "ACTIVITY_STATUS_REJECTED"].includes(result.status)) {
          return { confirmed: false, failed: true };
        }
        if (result.status === "ACTIVITY_STATUS_COMPLETED") {
          const done = await finishActivity(authority, document, setup, result, guard, progress);
          return {
            confirmed: done.status === "confirmed",
            ...(done.accountId ? { accountId: done.accountId } : {}),
            ...(done.encryptedToken ? { encryptedToken: done.encryptedToken } : {}),
            ...("txHash" in done ? { txHash: done.txHash } : {}),
          };
        }
      }
      if (!setup.txHash) {
        return { confirmed: false };
      }
      const receipt = (await rpc.call("eth_getTransactionReceipt", [setup.txHash])) as {
        status?: string;
        blockNumber?: string;
        blockHash?: string;
        from?: string;
      } | null;
      if (!receipt) {
        const prepared = preparation(setup.privatePreparation);
        if (prepared.signedTransaction && prepared.unsignedTransaction) {
          checkPreparedTransaction(setup);
          await verifySignedTransfer({
            signedTransaction: prepared.signedTransaction,
            unsignedTransaction: prepared.unsignedTransaction,
            signer: authority.address,
          });
          if (transactionHash(prepared.signedTransaction) !== setup.txHash) {
            throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Stored transaction hash changed");
          }
          await guard();
          // Only identical already-signed bytes may be redriven; the nonce and economic action stay fixed.
          await broadcastTransaction(rpc, prepared.signedTransaction);
        }
        return { confirmed: false };
      }
      if (!receipt || receipt.from?.toLowerCase() !== authority.address || !receipt.blockNumber) {
        return { confirmed: false };
      }
      const block = (await rpc.call("eth_getBlockByNumber", [receipt.blockNumber, false])) as {
        hash?: string;
      } | null;
      const head = BigInt(String(await rpc.call("eth_blockNumber", [])));
      if (block?.hash !== receipt.blockHash || head < BigInt(receipt.blockNumber) + 2n) {
        return { confirmed: false };
      }
      if (receipt.status === "0x0") {
        return { confirmed: false, failed: true };
      }
      if (receipt.status !== "0x1") {
        return { confirmed: false };
      }
      const id = await accountId(authority.address);
      return { confirmed: true, ...(id ? { accountId: id } : {}) };
    },
    async snapshot(authority, document) {
      const ctx = await context();
      const wallet = z
        .object({
          addr: z.string(),
          sn: integer,
          at,
          as: z.array(
            z.object({
              in: integer,
              id: integer,
              fw: z.boolean(),
              fr: z.boolean(),
              lfr: integer,
              b: amount,
              lb: amount,
            }),
          ),
        })
        .parse(await http.request("/v1/trading/wallet", { document }));
      if (wallet.addr.toLowerCase() !== authority.address) {
        throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Wallet snapshot owner changed");
      }
      const account = wallet.as.find(
        (a) => a.in === ctx.instance.id && a.id === document.accountId,
      );
      if (!account) {
        throw new PilotError("PERPL_ACCOUNT_CHANGED", "Exchange account identity changed");
      }
      const live = positionPage.parse(await http.request("/v1/trading/positions", { document }));
      const history = positionPage.parse(
        await http.request("/v1/trading/position-history?count=100", { document }),
      );
      const orders = z
        .object({ d: z.array(venueOrder).max(1000) })
        .parse(await http.request("/v1/trading/order-history?count=100", { document }));

      const outstanding = z
        .object({ d: z.array(venueOrder).max(1000) })
        .parse(await http.request("/v1/trading/orders", { document }));
      const membership = config.requestMembership
        ? await config.requestMembership(authority.scope, [
            ...new Set(
              [...orders.d, ...outstanding.d].map((o) => o.rq).concat(history.d.map((p) => p.rq)),
            ),
          ])
        : document.orders.map((o) => ({
            requestId: o.request.rq,
            orderType: o.request.t,
            sessionId: o.sessionId,
          }));
      const owned = membership.map((o) => o.requestId);
      const unmanagedOrders = outstanding.d.some(
        (o) =>
          o.acc === account.id && ctx.markets.some((m) => m.id === o.mkt) && !owned.includes(o.rq),
      );
      const latest = new Map<number, PerplLiveOrderEvidence>();
      for (const o of orders.d.filter((o) => o.acc === account.id && owned.includes(o.rq))) {
        if (!latest.has(o.rq)) {
          latest.set(o.rq, order(o));
        }
      }
      const openingRequests = new Set(
        membership.filter((item) => item.orderType <= 2).map((item) => item.requestId),
      );
      const positions = new Map<number, PerplLivePosition>();
      for (const p of live.d.filter((p) => p.acc === account.id)) {
        const observed = position(p);
        // Current snapshots can omit event provenance (rq=0). Associate only this document's
        // opening event for the exact position; retain current aggregate size/collateral.
        if (p.rq === 0) {
          const opening = history.d.find(
            (event) =>
              event.pid === p.pid &&
              event.acc === p.acc &&
              event.mkt === p.mkt &&
              event.sd === p.sd &&
              event.lv === p.lv &&
              event.st === 1 &&
              openingRequests.has(event.rq),
          );
          if (opening) {
            observed.requestId = opening.rq;
          }
        }
        positions.set(p.pid, observed);
      }
      for (const p of history.d.filter((p) => p.acc === account.id)) {
        if (!positions.has(p.pid)) {
          positions.set(p.pid, position(p));
        }
      }
      return {
        instanceId: ctx.instance.id,
        lockedMicros: account.lb,
        unmanagedOrders,
        accountId: account.id,
        forwarding: account.fw,
        frozen: account.fr,
        balanceMicros: account.b,
        lastRequestId: account.lfr,
        head: wallet.sn,
        at: wallet.at.t ?? Date.now(),
        markets: ctx.markets.map((m) => ({
          id: m.id,
          symbol: m.symbol,
          mark: m.mark,
          priceDecimals: m.priceDecimals,
          sizeDecimals: m.sizeDecimals,
          maxLeverage: m.maxLeverage,
          maxSlippageBps: Math.min(m.maxSlippageBps, policy.maxSlippageBps),
          ttlBlocks: m.ttlBlocks,
          takerFeeMicros: m.takerFeeMicros,
        })),
        positions: [...positions.values()],
        orders: [...latest.values()],
      };
    },
    async executionHead(document) {
      const wallet = z
        .object({
          addr: z.string(),
          sn: integer,
          as: z.array(
            z.object({ in: integer, id: integer, lfr: integer, fw: z.boolean(), fr: z.boolean() }),
          ),
        })
        .parse(await http.request("/v1/trading/wallet", { document }));
      if (
        wallet.addr.toLowerCase() !== document.address ||
        !wallet.as.some(
          (a) =>
            a.in === document.snapshot?.instanceId &&
            a.id === document.accountId &&
            a.fw &&
            !a.fr &&
            a.lfr < document.nextRequestId,
        )
      ) {
        throw new PilotError("PERPL_ACCOUNT_CHANGED", "Account execution permission changed");
      }
      return wallet.sn;
    },
    async submit(document, request, guard) {
      await chainGuard();
      return http.submit(document, request, guard);
    },
    async verifyTransaction(hash) {
      const receipt = (await rpc.call("eth_getTransactionReceipt", [hash])) as {
        status?: string;
        blockNumber?: string;
        blockHash?: string;
        logs?: { address?: string }[];
      } | null;
      if (
        !receipt ||
        receipt.status !== "0x1" ||
        !receipt.logs?.some((l) => l.address?.toLowerCase() === policy.exchange.toLowerCase())
      ) {
        return false;
      }
      const block = (await rpc.call("eth_getBlockByNumber", [receipt.blockNumber, false])) as {
        hash?: string;
      } | null;
      const head = BigInt(String(await rpc.call("eth_blockNumber", [])));
      return block?.hash === receipt.blockHash && head >= BigInt(receipt.blockNumber!) + 2n;
    },
  };
  return driver;
}
