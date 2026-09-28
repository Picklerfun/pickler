import { probePolymarketPreproduction } from "@pickler/infrastructure";

// Deliberately does not load .env, create a database connection or construct a signer.
if (process.argv.length > 2) {
  throw new Error("This read-only command accepts no arguments");
}
const report = await probePolymarketPreproduction();
console.log(JSON.stringify(report, null, 2));
if (!report.publicReadAccess) {
  process.exitCode = 1;
}
