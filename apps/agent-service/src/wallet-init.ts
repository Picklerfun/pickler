import { resolve } from "node:path";
import { initializeTradingWallet } from "@pickler/infrastructure/wallet";
try {
  console.log(JSON.stringify(await initializeTradingWallet(resolve(process.cwd(), ".env"))));
} catch {
  console.error(
    "Wallet initialization failed; existing credentials were not replaced. Check file permissions and wallet field consistency.",
  );
  process.exitCode = 1;
}
