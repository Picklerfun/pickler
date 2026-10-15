import path from "node:path";

export function parseAcceptanceOptions(argv, root) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    return { mode: "help" };
  }
  const modes = argv.filter((value) => ["--preflight", "--broadcast-testnet"].includes(value));
  if (modes.length !== 1) {
    throw new Error("Choose exactly one explicit acceptance mode");
  }
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === modes[0]) {
      continue;
    }
    if (!["--key-file", "--output", "--rpc"].includes(flag) || values[flag] !== undefined) {
      throw new Error("Unknown or repeated acceptance argument");
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing acceptance argument");
    }
    values[flag] = value;
  }
  if (
    !values["--key-file"] ||
    !values["--output"] ||
    !path.isAbsolute(values["--key-file"]) ||
    !path.isAbsolute(values["--output"])
  ) {
    throw new Error("Absolute key-file and output paths are required");
  }
  const output = path.resolve(values["--output"]);
  const relative = path.relative(root, output);
  if (!relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) {
    throw new Error("Private acceptance output must be outside the checkout");
  }
  const broadcast = modes[0] === "--broadcast-testnet";
  let rpc = "https://testnet-rpc.monad.xyz";
  if (broadcast && values["--rpc"]) {
    throw new Error("The broadcast RPC cannot be overridden");
  }
  if (!broadcast) {
    if (!values["--rpc"]) {
      throw new Error("Preflight requires an explicitly owned loopback fork");
    }
    const url = new URL(values["--rpc"]);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Preflight must use a loopback RPC without credentials");
    }
    rpc = url.href;
  }
  return {
    mode: broadcast ? "broadcast" : "preflight",
    broadcast,
    rpc,
    output,
    keyFile: values["--key-file"],
  };
}
