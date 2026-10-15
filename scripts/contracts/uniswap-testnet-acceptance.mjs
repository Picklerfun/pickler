import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
import { createRequire } from "node:module";
const root = path.resolve(__dirname, "../..");
import { parseAcceptanceOptions } from "./acceptance-options.mjs";
let options;
try {
  options = parseAcceptanceOptions(process.argv.slice(2), root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (options.mode === "help") {
  console.log(
    "Explicit faucet-funded contract acceptance (never a build hook):\n--preflight --rpc http://127.0.0.1:8555 --key-file /private/operator.env --output /private/acceptance\n--broadcast-testnet --key-file /private/operator.env --output /private/acceptance\nRequires a fresh matching local preflight. Maximum: 25M gas, 120 gwei, 3 test MON.",
  );
  process.exit(0);
}
const req = createRequire(root + "/packages/infrastructure/package.json");
const v = req("viem");
const { privateKeyToAccount, generatePrivateKey } = req("viem/accounts");
const { parse } = req("dotenv");
const { broadcast, rpc } = options;
fs.mkdirSync(options.output, { recursive: true, mode: 0o700 });
const realOutput = fs.realpathSync(options.output);
const outputRelative = path.relative(fs.realpathSync(root), realOutput);
if (
  !outputRelative ||
  (!outputRelative.startsWith(".." + path.sep) && !path.isAbsolute(outputRelative))
) {
  throw new Error("Symlinked checkout output is refused");
}
fs.chmodSync(realOutput, 0o700);
const out = path.join(realOutput, broadcast ? "remote" : "preflight");
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const secretFile = path.join(realOutput, "acceptance-secrets.json");
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(
    secretFile,
    JSON.stringify({ authority: generatePrivateKey(), treasury: generatePrivateKey() }),
    { mode: 0o600 },
  );
}
const secrets = JSON.parse(fs.readFileSync(secretFile));
if ((fs.statSync(options.keyFile).mode & 0o077) !== 0) {
  throw new Error("The operator key file must have private permissions (chmod 600)");
}
const env = parse(fs.readFileSync(options.keyFile));
const operator = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const authority = privateKeyToAccount(secrets.authority);
const treasury = privateKeyToAccount(secrets.treasury);
const maxFee = 120_000_000_000n;
const maxGas = 25_000_000n;
const maxCost = 3_000_000_000_000_000_000n;
let requests = 0;
const base = v.http(rpc, { retryCount: 0, timeout: 20000 });
const c = v.createPublicClient({
  transport: (options) => {
    const t = base(options);
    return {
      ...t,
      request: async (args, opts) => {
        if (++requests > 1800) {
          throw Error("RPC budget exhausted");
        }
        return t.request(args, opts);
      },
    };
  },
});
const names = [
  "PicklerFeeEscrowV2",
  "PicklerGraduationAdapterV4V2",
  "PicklerCurveDeployerV4V2",
  "PicklerLaunchFactory",
  "PicklerBondingCurve",
  "PicklerLiquidityLockerV2",
  "IUniswapV4Read",
  "IUniswapV4Router",
];
const artifacts = Object.fromEntries(
  names.map((n) => [
    n,
    JSON.parse(fs.readFileSync(path.join(root, "contracts/out", n + ".sol", n + ".json"))),
  ]),
);
const artifactHash = v.keccak256(v.toHex(stringifyArtifacts()));
function stringifyArtifacts() {
  return JSON.stringify(
    Object.fromEntries(names.map((name) => [name, artifacts[name].bytecode.object])),
  );
}
const erc = v.parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function totalSupply() view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
]);
const permitAbi = v.parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address user,address token,address spender) view returns(uint160 amount,uint48 expiration,uint48 nonce)",
]);
const quoterAbi = v.parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)",
]);
const address = {
  pool: "0x451D64ab3b650040d2aE1886602b97ed6eDc643d",
  positions: "0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A",
  state: "0xB639209539c61BaF67AC04876315786F8D0b153c",
  permit: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  router: "0x1b7bFCd2870329B987191910D85c22C7287f3c22",
  quoter: "0x869834d127b230283fe63E0d0A9bEB67216a94C7",
  quote: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
};
const expected = {
  pool: "0x61199025286997b715457c68f86dbc42c847753f01e0773668394a405d53d579",
  positions: "0x3452caf821d383d2b18ae48cc0d1467b179b07a1198b8d72153181fcbc556ed5",
  state: "0xeedadde80f69c3b89437996025759b839a65e12db6c8379a7327a34aa269fa5e",
  permit: "0xe8ca368abb6fa7f5d31b388b14e16d3654281140695486df9a22d7d9b75df310",
  router: "0x82fe297858b607b6f6b5599928724441acd046e3dbd19971ec3d6be6587997c6",
  quoter: "0xdc1a524cd6108e0d1d90c5de1b594b2f953feaf9dc6c2387ecd1b4232ea0e521",
  quote: "0xa3bda7298d1c5f8585852ee04439f9cc493e5c291c9cac74fa54a0bc67024a7b",
  faucet: "0x7ea12d4d718fd07f2a0076772648286b771d074b1edbda6582104eb9d7f574a3",
};
const stringify = (x) =>
  JSON.stringify(x, (_, val) => (typeof val === "bigint" ? val.toString() : val), 2);
const journalFile = path.join(out, "private-journal.json");
const journal = fs.existsSync(journalFile)
  ? JSON.parse(fs.readFileSync(journalFile))
  : { actions: {}, startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(journalFile, stringify(journal), { mode: 0o600 });
const check = (condition, message) => {
  if (!condition) {
    throw Error(message);
  }
};
const read = (name, target, fn, args = []) =>
  c.readContract({ address: target, abi: artifacts[name]?.abi ?? name, functionName: fn, args });
const balance = (target) => read(erc, target, "balanceOf", [operator.address]);
let gasCommitted = Object.values(journal.actions).reduce((n, a) => n + BigInt(a.gas), 0n);
async function send(label, to, data, signer = operator, value = 0n) {
  let a = journal.actions[label];
  if (!a) {
    const nonce = await c.getTransactionCount({ address: signer.address, blockTag: "pending" });
    const estimate = await c.estimateGas({ account: signer.address, to, data, value });
    const gas = (estimate * 12n + 9n) / 10n;
    check(
      gas <= 8_000_000n && gasCommitted + gas <= maxGas && (gasCommitted + gas) * maxFee <= maxCost,
      "Gas ceiling exceeded",
    );
    check(
      (await c.getBalance({ address: signer.address })) >= gas * maxFee + value,
      "Insufficient native balance",
    );
    check((await c.getGasPrice()) <= maxFee, "Current fee exceeds approved ceiling");
    const raw = await signer.signTransaction({
      type: "eip1559",
      chainId: 10143,
      nonce,
      to,
      data,
      value,
      gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: 2_000_000_000n,
    });
    a = {
      hash: v.keccak256(raw),
      raw,
      gas: gas.toString(),
      sender: signer.address,
      nonce,
      status: "prepared",
    };
    journal.actions[label] = a;
    gasCommitted += gas;
    save();
    try {
      const hash = await c.sendRawTransaction({ serializedTransaction: raw });
      check(hash === a.hash, "Broadcast hash mismatch");
      a.status = "broadcast";
      save();
    } catch {
      a.status = "unknown";
      save();
      throw Error(
        label + ": broadcast uncertain; reconcile the stored hash, never replace or repeat it",
      );
    }
  }
  const receipt = await c.waitForTransactionReceipt({
    hash: a.hash,
    timeout: 60000,
    retryCount: 0,
  });
  const canonical = await c.getBlock({ blockNumber: receipt.blockNumber });
  check(canonical.hash === receipt.blockHash, "Receipt was reorganized; stop and reconcile");
  check(receipt.status === "success", label + ": transaction reverted");
  a.status = "included";
  a.receipt = receipt;
  save();
  console.log(label, a.hash, "gas", receipt.gasUsed.toString());
  return receipt;
}
const write = (label, name, target, fn, args = [], signer = operator) =>
  send(
    label,
    target,
    v.encodeFunctionData({ abi: artifacts[name]?.abi ?? name, functionName: fn, args }),
    signer,
  );
async function deploy(name, args) {
  const data = v.encodeDeployData({
    abi: artifacts[name].abi,
    bytecode: artifacts[name].bytecode.object,
    args,
  });
  const receipt = await send("deploy-" + name, undefined, data);
  check(receipt.contractAddress, "Missing deployment address");
  address[name] = receipt.contractAddress;
  return receipt.contractAddress;
}
async function swap(label, input, amount, key) {
  if (journal.actions[label + "-revoke-erc20"]?.status === "included") {
    return;
  }
  const zeroForOne = input.toLowerCase() === key.currency0.toLowerCase();
  const output = zeroForOne ? key.currency1 : key.currency0;
  journal.swaps ??= {};
  if (!journal.swaps[label]) {
    const before = await balance(output);
    const { result } = await c.simulateContract({
      account: operator.address,
      address: address.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: "0x" }],
    });
    const minimum = (result[0] * 99n) / 100n;
    check(minimum > 0n, "Invalid swap quote");
    const deadline = (await c.getBlock()).timestamp + 300n;
    journal.swaps[label] = { before, minimum, deadline };
    save();
  }
  const {
    before: storedBefore,
    minimum: storedMinimum,
    deadline: storedDeadline,
  } = journal.swaps[label];
  const before = BigInt(storedBefore),
    minimum = BigInt(storedMinimum),
    deadline = BigInt(storedDeadline);
  await write(label + "-erc20", erc, input, "approve", [address.permit, amount]);
  await write(label + "-permit", permitAbi, address.permit, "approve", [
    input,
    address.router,
    amount,
    Number(deadline),
  ]);
  const params = [
    v.encodeAbiParameters(
      v.parseAbiParameters(
        "((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)",
      ),
      [[Object.values(key), zeroForOne, amount, minimum, 0n, "0x"]],
    ),
    v.encodeAbiParameters(v.parseAbiParameters("address,uint256"), [input, amount]),
    v.encodeAbiParameters(v.parseAbiParameters("address,uint256"), [output, minimum]),
  ];
  const commands = v.encodeAbiParameters(v.parseAbiParameters("bytes,bytes[]"), [
    "0x060c0f",
    params,
  ]);
  await write(label, "IUniswapV4Router", address.router, "execute", ["0x10", [commands], deadline]);
  check((await balance(output)) - before >= minimum, "Swap output below minimum");
  await write(label + "-revoke-permit", permitAbi, address.permit, "approve", [
    input,
    address.router,
    0n,
    0,
  ]);
  await write(label + "-revoke-erc20", erc, input, "approve", [address.permit, 0n]);
}
(async () => {
  check((await c.getChainId()) === 10143, "Only Monad testnet is admitted");
  if (broadcast) {
    const preflight = JSON.parse(fs.readFileSync(path.join(realOutput, "preflight/result.json")));
    check(
      preflight.wallet.toLowerCase() === operator.address.toLowerCase() &&
        preflight.artifactHash === artifactHash,
      "Preflight wallet or compiled contracts changed",
    );
    check(
      preflight.success &&
        preflight.gasCeiling === maxGas.toString() &&
        preflight.maximumGasCost === maxCost.toString(),
      "Successful bounded local preflight required",
    );
    check(Date.now() - Date.parse(preflight.completedAt) < 3600000, "Preflight expired");
  }
  for (const [label, action] of Object.entries(journal.actions)) {
    const receipt = await c.waitForTransactionReceipt({
      hash: action.hash,
      timeout: 60000,
      retryCount: 0,
    });
    const block = await c.getBlock({ blockNumber: receipt.blockNumber });
    check(
      receipt.status === "success" && block.hash === receipt.blockHash,
      "Unresolved or reorganized previous transaction: " + label,
    );
    action.receipt = receipt;
    action.status = "included";
    save();
  }
  for (const [key, hash] of Object.entries(expected)) {
    check(
      v.keccak256(await c.getCode({ address: address[key] })) === hash,
      "External deployment changed: " + key,
    );
  }
  const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const slot = await c.getStorageAt({ address: address.quote, slot: implementationSlot });
  check(
    slot.slice(-40) === "c1e3c7d486d6a92fbe920232e439eec2ceb112da",
    "AUSD implementation changed",
  );
  check(
    v.keccak256(await c.getCode({ address: "0x" + slot.slice(-40) })) ===
      "0x2e612fde7bb56c8b5c52e68eb50ded8302e686c5dd42b84f71a9f9d52bc99a90",
    "AUSD implementation code changed",
  );
  journal.initialBalances ??= {
    AUSD: await balance(address.quote),
    MON: await c.getBalance({ address: operator.address }),
  };
  save();
  check(
    BigInt(journal.initialBalances.MON) >= maxCost + 50_000_000_000_000_000n,
    "Native funds below cumulative worst-case ceiling",
  );
  for (
    let i = 1;
    !journal.actions["create-launch"] && i <= 3 && (await balance(address.quote)) < 33_000_000_000n;
    i++
  ) {
    const prior = Object.entries(journal.actions)
      .filter(([label]) => label.startsWith("faucet-"))
      .at(-1)?.[1];
    if (prior && !journal.actions["faucet-" + i]) {
      if (!broadcast) {
        await c.request({ method: "evm_increaseTime", params: [62] });
        await c.request({ method: "evm_mine", params: [] });
      } else {
        const block = await c.getBlock({ blockNumber: BigInt(prior.receipt.blockNumber) });
        const remaining = Math.max(0, Number(block.timestamp) + 62 - Math.floor(Date.now() / 1000));
        if (remaining > 0) {
          console.log("Respecting faucet cooldown before the next request");
          for (let seconds = remaining; seconds > 0; seconds -= 30) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(30, seconds) * 1000));
          }
        }
      }
    }
    await write(
      "faucet-" + i,
      v.parseAbi(["function requestFunds(address)"]),
      address.faucet,
      "requestFunds",
      [operator.address],
    );
  }
  if (!journal.actions["create-launch"]) {
    check(
      (await balance(address.quote)) >= 33_000_000_000n,
      "Faucet did not provide enough AUSD; stop without substituting assets",
    );
  }
  const escrow = await deploy("PicklerFeeEscrowV2", [treasury.address]);
  const adapter = await deploy("PicklerGraduationAdapterV4V2", [
    address.pool,
    address.positions,
    address.state,
    address.permit,
    escrow,
    {
      version: 1,
      quoteToken: address.quote,
      feeTier: 10000,
      tickSpacing: 200,
      sqrtPriceToleranceBps: 5,
    },
  ]);
  const locker = await read("PicklerGraduationAdapterV4V2", adapter, "locker");
  address.locker = locker;
  const deployer = await deploy("PicklerCurveDeployerV4V2", [adapter, escrow]);
  const factory = await deploy("PicklerLaunchFactory", [
    operator.address,
    deployer,
    authority.address,
  ]);
  await write("initialize-escrow", "PicklerFeeEscrowV2", escrow, "initialize", [factory, locker]);
  const preset = {
    presetId: 1,
    version: 4,
    quoteToken: address.quote,
    totalSupply: 21_000_000n * 10n ** 18n,
    saleAllocation: 16_800_000n * 10n ** 18n,
    lpAllocation: 4_200_000n * 10n ** 18n,
    virtualTokenReserve: 22_400_000n * 10n ** 18n,
    virtualQuoteReserve: 10_666_666_666n,
    buyFeeBps: 100,
    sellFeeBps: 100,
    protocolShareBps: 5000,
    lpCreatorShareBps: 5000,
    lpFeeTier: 10000,
    lpTickSpacing: 200,
    launchFee: 0n,
    roundingPolicyVersion: 2,
  };
  const venue = await read("PicklerGraduationAdapterV4V2", adapter, "venueConfigHash");
  await write("publish-preset", "PicklerLaunchFactory", factory, "publishPresetWithVenue", [
    preset,
    venue,
  ]);
  if (!journal.launch) {
    const params = {
      agentKey: v.keccak256(v.toHex("Pickler controlled Uniswap acceptance " + journal.startedAt)),
      creator: operator.address,
      creatorFeeRecipient: operator.address,
      name: "Pickler Uniswap Test",
      symbol: "PVT4",
      metadataURI: "urn:pickler:controlled-testnet-acceptance",
      metadataHash: v.keccak256(
        v.toHex("Controlled acceptance: not a public agent or production metadata"),
      ),
      presetId: 1,
      presetVersion: 4,
      expectedConfigHash: await read(
        "PicklerLaunchFactory",
        factory,
        "getPresetConfigHash",
        [1, 4],
      ),
      nonce: 0n,
      deadline: (await c.getBlock()).timestamp + 300n,
    };
    const paramsHash = v.keccak256(
      v.encodeAbiParameters(
        v.parseAbiParameters(
          "bytes32,bytes32,bytes32,bytes32,uint32,uint32,bytes32,uint256,uint256",
        ),
        [
          v.keccak256(v.toHex(params.name)),
          v.keccak256(v.toHex(params.symbol)),
          v.keccak256(v.toHex(params.metadataURI)),
          params.metadataHash,
          1,
          4,
          params.expectedConfigHash,
          0n,
          params.deadline,
        ],
      ),
    );
    const grantNonce = BigInt(params.agentKey);
    const typed = {
      domain: { name: "Pickler", version: "2", chainId: 10143, verifyingContract: factory },
      types: {
        LaunchGrant: [
          { name: "agentKey", type: "bytes32" },
          { name: "creator", type: "address" },
          { name: "creatorFeeRecipient", type: "address" },
          { name: "paramsHash", type: "bytes32" },
          { name: "grantNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "LaunchGrant",
      message: {
        agentKey: params.agentKey,
        creator: operator.address,
        creatorFeeRecipient: operator.address,
        paramsHash,
        grantNonce,
        deadline: params.deadline,
      },
    };
    check(
      v.hashTypedData(typed) ===
        (await read("PicklerLaunchFactory", factory, "grantDigest", [
          params,
          grantNonce,
          params.deadline,
        ])),
      "Grant digest mismatch",
    );
    journal.launch = { params, grantNonce, signature: await authority.signTypedData(typed) };
    save();
  }
  const params = journal.launch.params;
  params.nonce = BigInt(params.nonce);
  params.deadline = BigInt(params.deadline);
  const launchReceipt = await write(
    "create-launch",
    "PicklerLaunchFactory",
    factory,
    "createLaunch",
    [params, "0x", BigInt(journal.launch.grantNonce), params.deadline, journal.launch.signature],
  );
  const event = launchReceipt.logs
    .map((log) => {
      try {
        return v.decodeEventLog({
          abi: artifacts.PicklerLaunchFactory.abi,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "LaunchCreated");
  check(event, "Canonical launch event missing");
  const token = event.args.token;
  const curve = event.args.curve;
  address.token = token;
  address.curve = curve;
  check((await read(erc, token, "totalSupply")) === preset.totalSupply, "Supply mismatch");
  await write("approve-curve", erc, address.quote, "approve", [curve, 33_000_000_000n]);
  const small = 1000n * 10n ** 18n;
  if (!journal.actions["curve-buy-small"]) {
    await write("curve-buy-small", "PicklerBondingCurve", curve, "buyExactOutput", [
      small,
      await read("PicklerBondingCurve", curve, "quoteBuyExactOutput", [small]),
      operator.address,
      (await c.getBlock()).timestamp + 300n,
    ]);
  }
  await write("approve-curve-sale", erc, token, "approve", [curve, small]);
  if (!journal.actions["curve-sell-small"]) {
    await write("curve-sell-small", "PicklerBondingCurve", curve, "sellExactInput", [
      small,
      await read("PicklerBondingCurve", curve, "quoteSell", [small]),
      operator.address,
      (await c.getBlock()).timestamp + 300n,
    ]);
  }
  if (!journal.actions["curve-exhaust"]) {
    const remaining = await read("PicklerBondingCurve", curve, "remainingTokens");
    await write("curve-exhaust", "PicklerBondingCurve", curve, "buyExactOutput", [
      remaining,
      await read("PicklerBondingCurve", curve, "quoteBuyExactOutput", [remaining]),
      operator.address,
      (await c.getBlock()).timestamp + 300n,
    ]);
  }
  journal.backing ??= await read("PicklerBondingCurve", curve, "realQuoteReserve");
  save();
  await write("graduate", "PicklerGraduationAdapterV4V2", adapter, "finalizeGraduation", [curve]);
  const position = await read("PicklerLiquidityLockerV2", locker, "getLockedPosition", [token]);
  check(
    position.liquidity > 0n &&
      (
        await read("IUniswapV4Read", address.positions, "ownerOf", [position.tokenId])
      ).toLowerCase() === locker.toLowerCase(),
    "Position not permanently owned by locker",
  );
  await swap("uniswap-buy", address.quote, 100_000_000n, position.poolKey);
  await swap("uniswap-sell", token, 10_000n * 10n ** 18n, position.poolKey);
  await write("collect-lp-fees", "PicklerLiquidityLockerV2", locker, "collectFees", [token]);
  const lpReceipts = journal.lpReceipts ?? {};
  for (const asset of [address.quote, token]) {
    const creator = BigInt(
      lpReceipts[asset]?.creator ??
        (await read("PicklerFeeEscrowV2", escrow, "claimable", [operator.address, asset])),
    );
    const protocol = BigInt(
      lpReceipts[asset]?.protocol ??
        (await read("PicklerFeeEscrowV2", escrow, "claimable", [treasury.address, asset])),
    );
    check(
      creator > 0n &&
        (creator === protocol || creator === protocol + 1n || protocol === creator + 1n),
      "LP split is not 50/50",
    );
    lpReceipts[asset] = { creator, protocol };
  }
  journal.lpReceipts = lpReceipts;
  save();
  await write("remit-curve-fees", "PicklerBondingCurve", curve, "remitFees");
  const claims = journal.claims ?? {};
  await send("fund-treasury-gas", treasury.address, "0x", operator, 50_000_000_000_000_000n);
  for (const [actor, signer] of [
    ["creator", operator],
    ["protocol", treasury],
  ]) {
    for (const [assetName, asset] of [
      ["AUSD", address.quote],
      ["agent", token],
    ]) {
      if (journal.actions["claim-" + actor + "-" + assetName]?.status === "included") {
        check(
          (await read("PicklerFeeEscrowV2", escrow, "claimable", [signer.address, asset])) === 0n,
          "Already executed claim is not settled",
        );
        continue;
      }
      const amount = BigInt(
        claims[actor + "-" + assetName] ??
          (await read("PicklerFeeEscrowV2", escrow, "claimable", [signer.address, asset])),
      );
      check(amount > 0n, "Missing fee claim");
      claims[actor + "-" + assetName] = amount;
      journal.claims = claims;
      save();
      const before = await read(erc, asset, "balanceOf", [signer.address]);
      await write(
        "claim-" + actor + "-" + assetName,
        "PicklerFeeEscrowV2",
        escrow,
        "claim",
        [asset, signer.address],
        signer,
      );
      check(
        (await read(erc, asset, "balanceOf", [signer.address])) === before + amount,
        "Claim balance mismatch",
      );
      claims[actor + "-" + assetName] = amount;
      journal.claims = claims;
      save();
    }
  }
  const remainingLiquidity = await read(
    "IUniswapV4Read",
    address.positions,
    "getPositionLiquidity",
    [position.tokenId],
  );
  check(
    remainingLiquidity === position.liquidity,
    "Principal liquidity changed during fee collection",
  );
  check(
    (await read(erc, token, "balanceOf", [locker])) === position.tokenRemainder &&
      (await read(erc, address.quote, "balanceOf", [locker])) === position.quoteRemainder,
    "Locked remainders changed",
  );
  await write("close-general-launches", "PicklerLaunchFactory", factory, "setLaunchesEnabled", [
    false,
  ]);
  const deployed = {};
  for (const [name, target] of Object.entries(address).filter(
    ([n]) => names.includes(n) || ["locker", "token", "curve"].includes(n),
  )) {
    deployed[name] = {
      address: target,
      runtimeHash: v.keccak256(await c.getCode({ address: target })),
    };
  }
  const receipts = Object.fromEntries(
    Object.entries(journal.actions).map(([label, a]) => [
      label,
      {
        hash: a.hash,
        gasUsed: a.receipt.gasUsed,
        effectiveGasPrice: a.receipt.effectiveGasPrice,
        blockNumber: a.receipt.blockNumber,
        blockHash: a.receipt.blockHash,
        contractAddress: a.receipt.contractAddress,
      },
    ]),
  );
  const result = {
    success: true,
    kind: broadcast ? "real_testnet_contract_acceptance" : "local_fork_preflight",
    chainId: 10143,
    artifactHash,
    completedAt: new Date().toISOString(),
    gasCeiling: maxGas.toString(),
    maximumFeePerGas: maxFee.toString(),
    maximumGasCost: maxCost.toString(),
    gasCommitted,
    actualGas: Object.values(journal.actions).reduce((n, a) => n + BigInt(a.receipt.gasUsed), 0n),
    actualGasCost: Object.values(journal.actions).reduce(
      (n, a) => n + BigInt(a.receipt.gasUsed) * BigInt(a.receipt.effectiveGasPrice),
      0n,
    ),
    requests,
    wallet: operator.address,
    treasury: treasury.address,
    authority: authority.address,
    addresses: deployed,
    external: address,
    initialBalances: journal.initialBalances,
    finalBalances: {
      AUSD: await balance(address.quote),
      MON: await c.getBalance({ address: operator.address }),
    },
    backingReleased: journal.backing,
    position,
    remainingLiquidity,
    lpReceipts,
    claims,
    venueHash: venue,
    presetConfigHash: params.expectedConfigHash,
    receipts,
    exclusions: [
      "Production metadata",
      "Studio JWT ownership",
      "User passkey",
      "Hosted indexer",
      "General activation",
      "Mainnet",
    ],
  };
  fs.writeFileSync(path.join(out, "result.json"), stringify(result));
  console.log(
    stringify({
      success: true,
      kind: result.kind,
      actualGas: result.actualGas,
      gasCommitted,
      gasCostMON: v.formatEther(result.actualGasCost),
      transactionCount: Object.keys(receipts).length,
    }),
  );
})().catch((x) => {
  console.error(x.shortMessage ?? x.message);
  process.exitCode = 1;
});
