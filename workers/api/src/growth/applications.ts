import {
  APPLICATION_LIMITS_DTO,
  type ApplicantResponse,
  type ApplicationFieldDto,
} from "@pickler/api-schema";
import type { createGrowthServices } from "./services";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { getCookie } from "hono/cookie";
import { toApplicantResponse } from "./applicant-response";

import { errorResponse, toErrorResponse } from "./errors";
import { readJsonObject } from "./read-json";

const FIELDS: ApplicationFieldDto[] = [
  "agentName",
  "ticker",
  "xHandle",
  "category",
  "personality",
  "edge",
  "whyYou",
];
// Generous ceiling above the business limits; exact lengths are checked in core.
const MAX_BODY_BYTES =
  4 *
    (APPLICATION_LIMITS_DTO.agentName +
      APPLICATION_LIMITS_DTO.edge +
      APPLICATION_LIMITS_DTO.whyYou) +
  1024;

export async function GET(c: Context<AppEnv>, services: ReturnType<typeof createGrowthServices>) {
  try {
    const applicant = await services.getApplicant(getCookie(c, "pk_apply") ?? null);
    if (!applicant) {
      return errorResponse(401, "no_seat", "Join the waitlist from this browser first.");
    }
    const body: ApplicantResponse = toApplicantResponse(applicant);
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(c: Context<AppEnv>, services: ReturnType<typeof createGrowthServices>) {
  const body = await readJsonObject(c.req.raw, MAX_BODY_BYTES);
  if (body instanceof Response) {
    return body;
  }
  const input = {} as Record<ApplicationFieldDto, string>;
  for (const field of FIELDS) {
    const value = body[field];
    if (typeof value !== "string") {
      return errorResponse(400, "invalid_request", `Field '${field}' must be a string.`);
    }
    input[field] = value;
  }

  try {
    const applicant = await services.submitApplication(getCookie(c, "pk_apply") ?? null, input);
    const response: ApplicantResponse = toApplicantResponse(applicant);
    return Response.json(response, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
