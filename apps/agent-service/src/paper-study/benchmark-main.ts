import { assertLegacyRead } from "../evaluation-host/legacy.js";
import { runBtcBenchmark } from "./benchmark-host.js";
assertLegacyRead(process.argv[2], ["report", "compare", "settle"]);
await runBtcBenchmark(process.argv.slice(2));
