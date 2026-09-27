import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { localDirectory, writeImmutable } from "./observation/capture";
import { prepareObservation } from "./observation/prepare";
import { initializeCampaign, campaignSchema, readOptional } from "./observation/ledger";
import { runObservation, observationReport } from "./observation/run";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      directory: { type: "string" },
      campaign: { type: "string" },
      capture: { type: "string" },
      selections: { type: "string" },
      "approve-paid": { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !["init", "prepare", "run", "report"].includes(command ?? "") ||
    !values.directory
  ) {
    throw new Error(
      "Use init|prepare|run|report --directory .data/decision-observations [--campaign FILE | --capture FILE --selections FILE]. run additionally requires --approve-paid.",
    );
  }
  const directory = localDirectory(values.directory);
  if (command === "init") {
    if (!values.campaign) {
      throw new Error("Campaign manifest required; no implicit paid allowance.");
    }
    await initializeCampaign(directory, JSON.parse(await readFile(values.campaign, "utf8")));
    console.log("Observation campaign initialized. No provider calls made.");
    return;
  }
  if (!values.capture || !values.selections) {
    throw new Error("Explicit capture and claim selections required.");
  }
  const cases = prepareObservation(
    JSON.parse(await readFile(values.capture, "utf8")),
    JSON.parse(await readFile(values.selections, "utf8")),
  );
  if (command === "prepare") {
    console.log(
      JSON.stringify(
        {
          mode: "offline-preflight",
          cases: cases.map((c) => ({
            id: c.id,
            label: c.label,
            eventId: c.eventId,
            fragments: c.state.fragments.length,
          })),
          providerCalls: 0,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "run") {
    if (!values["approve-paid"]) {
      throw new Error(
        "Paid observation requires --approve-paid and a previously authorized campaign.",
      );
    }
    config({ path: resolve(process.cwd(), ".env"), quiet: true });
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const result = await runObservation(directory, cases, process.env, controller.signal);
      if (result.stopCode) {
        process.exitCode = 1;
      }
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  }
  const campaign = campaignSchema.parse(await readOptional(resolve(directory, "campaign.json")));
  const report = await observationReport(directory, cases, campaign);
  await writeImmutable(resolve(directory, "reports", `${Date.now()}.json`), report);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch(() => {
  console.error(
    "Observation command failed; inspect arguments, private campaign records and STOP/LOCK state. No automatic retry.",
  );
  process.exitCode = 1;
});
