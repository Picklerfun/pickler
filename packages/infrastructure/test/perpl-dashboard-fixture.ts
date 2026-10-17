/** Test-only Perpl transport: no provider, credential enrollment or chain transaction. */
import { readFileSync } from "node:fs";
import {
  PERPL_READ_KEY_TYPES,
  PERPL_READ_KEY_LABEL,
  PERPL_DASHBOARD_ORIGIN,
} from "@pickler/api-schema";
export const DASHBOARD_WALLET = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
export function controlledPerpl(now: () => number = Date.now, wallet = DASHBOARD_WALLET) {
  const context = JSON.parse(
    readFileSync(
      new URL("../../perpl-context/test/fixtures/context.json", import.meta.url),
      "utf8",
    ),
  );
  let marks = 0;
  let unavailable = false;
  let wrongWallet = false;
  let enrollment: Record<string, unknown> | null = null;
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (target, init) => {
    const url = new URL(String(target));
    if (url.origin !== "https://testnet.perpl.xyz") {
      throw new Error("Forbidden provider");
    }
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (unavailable) {
      return new Response("private provider error", { status: 503 });
    }
    if (path.endsWith("/pub/context")) {
      const copy = structuredClone(context);
      copy.markets.find((m: { id: number }) => m.id === 16).state.mrk += marks;
      return Response.json(copy);
    }
    if (path.endsWith("/api-key/payload")) {
      if (body.scope_mask !== 1 || body.label !== PERPL_READ_KEY_LABEL) {
        throw new Error("Wrong scope");
      }
      const publicKey = Buffer.from(body.public_key.slice(2), "hex").toString("base64url");
      return Response.json({
        typed_data: {
          types: PERPL_READ_KEY_TYPES,
          primaryType: "PerplRegisterApiKey",
          domain: {
            name: "perpl.xyz",
            version: "1",
            chainId: "0x279f",
            verifyingContract: "0x" + "0".repeat(40),
            salt: "0x" + "1".repeat(64),
          },
          message: {
            signer: body.address,
            statement:
              "I authorize the creation of Perpl API key with the specified scope and parameters",
            publicKey,
            scope: "1",
            label: body.label,
            expiresAt: String(body.expires_at),
            ipCidrs: "",
            origin: PERPL_DASHBOARD_ORIGIN,
            builderId: "0",
            maxBuilderFeePer100K: "0",
            time: String(now()),
          },
        },
        mac: "0x" + "2".repeat(64),
      });
    }
    if (path.endsWith("/api-key/enroll")) {
      enrollment = body;
      return Response.json({
        api_key: {
          api_key: "controlled-read-token",
          address: body.address,
          scope_mask: 1,
          expires_at: Number(body.typed_data.message.expiresAt),
        },
      });
    }
    if (path.endsWith("/trading/wallet")) {
      return Response.json({
        mt: 19,
        sn: 100,
        addr: wrongWallet ? "0x" + "9".repeat(40) : wallet,
        as: [{ id: 619, in: 12, b: "500000000", lb: "20000000", fr: false }],
        sts: [{ id: 619, trp: "32500000", tf: "400000", tv: "23450000000" }],
      });
    }
    if (path.endsWith("/trading/positions")) {
      const btc = context.markets.find((m: { id: number }) => m.id === 16);
      const eth = context.markets.find((m: { id: number }) => m.id === 32);
      return Response.json({
        mt: 26,
        sn: 101,
        d: [
          {
            pid: 7,
            acc: 619,
            mkt: 16,
            st: 1,
            sd: 1,
            s: 1000,
            ep: btc.state.mrk - 400,
            c: "200000000",
            lv: 500,
          },
          {
            pid: 8,
            acc: 619,
            mkt: 32,
            st: 1,
            sd: 2,
            s: 100,
            ep: eth.state.mrk + 100,
            c: "100000000",
            lv: 300,
          },
        ],
      });
    }
    throw new Error("Forbidden Perpl target " + path);
  };
  return {
    fetcher,
    calls,
    get enrollment() {
      return enrollment;
    },
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    setWrongWallet(value: boolean) {
      wrongWallet = value;
    },
    updateMarks() {
      marks += 100;
    },
  };
}
