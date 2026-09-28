import { assertLegacyRead } from "../evaluation-host/legacy.js";
import { runPerpsStudy } from "./host.js";
assertLegacyRead(process.argv[2], ["report", "stop", "settle", "--help"]);
await runPerpsStudy(process.argv.slice(2));
