import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { createApp } from "../src/app";
import { documentationServices } from "../src/openapi/composition";
import { assertDocumentCoverage } from "../src/openapi/coverage";
import { apiDocument } from "../src/openapi/document";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") {
  throw new Error("Usage: npm run api:openapi -- --output <file>");
}
const app = createApp(documentationServices());
const document = await apiDocument(app);
const count = assertDocumentCoverage(app, document);
await SwaggerParser.validate(structuredClone(document), { resolve: { external: false } });
const output = resolve(args[1]!);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Exported ${count} documented operations to ${output}`);
