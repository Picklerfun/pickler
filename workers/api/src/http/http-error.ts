// Replaces NestJS HttpException subclasses for route code.

import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorExtras } from "./envelope";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly extras?: ErrorExtras,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, extras?: ErrorExtras) =>
  new HttpError(400, message, extras);
export const notFound = (resource: string) => new HttpError(404, `${resource} not found`);
