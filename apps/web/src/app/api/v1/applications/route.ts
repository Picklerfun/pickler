import {
  APPLICATION_LIMITS_DTO,
  type ApplicantResponse,
  type ApplicationFieldDto,
} from "@pickler/api-schema";
import { services } from "@/server/container";
import { toApplicantResponse } from "@/server/http/applicant-response";
import { readApplyToken } from "@/server/http/apply-cookie";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { readJsonObject } from "@/server/http/read-json";

export const runtime = "nodejs";

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

export async function GET() {
  try {
    const applicant = await services.getApplicant(await readApplyToken());
    if (!applicant) {
      return errorResponse(401, "no_seat", "Join the waitlist from this browser first.");
    }
    const body: ApplicantResponse = toApplicantResponse(applicant);
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = await readJsonObject(request, MAX_BODY_BYTES);
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
    const applicant = await services.submitApplication(await readApplyToken(), input);
    const response: ApplicantResponse = toApplicantResponse(applicant);
    return Response.json(response, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
