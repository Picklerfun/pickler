import type { Hono } from "hono";
import type { AppEnv } from "../env";
import type { apiDocument } from "./document";

export function assertDocumentCoverage(
  app: Hono<AppEnv>,
  document: Awaited<ReturnType<typeof apiDocument>>,
) {
  const expected = new Set(
    app.routes
      .filter((route) => route.method !== "ALL")
      .map(
        (route) =>
          `${route.method.toLowerCase()} ${route.path.replace(/:([^/]+)/g, "{$1}").replace(/\/$/, "") || "/"}`,
      ),
  );
  const actual = new Set<string>();
  const ids = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
      "trace",
    ] as const) {
      const operation = item?.[method];
      if (!operation) {
        continue;
      }
      actual.add(`${method} ${path.replace(/\/$/, "") || "/"}`);
      if (!operation.operationId || ids.has(operation.operationId)) {
        throw new Error(`Missing or duplicate operationId: ${method} ${path}`);
      }
      ids.add(operation.operationId);
      if (!operation.summary || !operation.responses || !operation.security) {
        throw new Error(`Incomplete documentation: ${method} ${path}`);
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (
          /^3\d\d$/.test(status) &&
          "headers" in response &&
          response.headers?.Location &&
          !("content" in response)
        ) {
          const location = response.headers.Location;
          if (
            !("schema" in location) ||
            !location.schema ||
            !("type" in location.schema) ||
            location.schema.type !== "string"
          ) {
            throw new Error(`Missing redirect Location schema: ${method} ${path}`);
          }
          continue;
        }
        if (!("content" in response) || !response.content?.["application/json"]?.schema) {
          throw new Error(`Missing JSON response schema: ${method} ${path}`);
        }
        const schema = response.content["application/json"].schema;
        if (!["type", "$ref", "allOf", "anyOf", "oneOf"].some((key) => key in schema)) {
          throw new Error(`Opaque response schema: ${method} ${path}`);
        }
      }
    }
  }
  for (const key of expected) {
    if (!actual.has(key)) {
      throw new Error(`Undocumented route: ${key}`);
    }
  }
  for (const key of actual) {
    if (!expected.has(key)) {
      throw new Error(`Documented route not mounted: ${key}`);
    }
  }
  return ids.size;
}
