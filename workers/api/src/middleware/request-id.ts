import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

const VALID = /^[A-Za-z0-9-]{8,64}$/;

/** Reuses a well-formed incoming X-Request-Id, otherwise generates one. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
});
