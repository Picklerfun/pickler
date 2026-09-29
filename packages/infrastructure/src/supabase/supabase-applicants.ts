import { DataSourceUnavailableError, type ApplicantRepository } from "@pickler/core";
import { z } from "zod";
import { applicantSchema, outcomeSchema } from "../persistence/growth-store.js";
import type { SupabaseRestClient } from "./supabase-rest-client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse<T>(schema: z.ZodType<T>, body: unknown, fn: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new DataSourceUnavailableError(`supabase.rpc.${fn}`, { cause: parsed.error });
  }
  return parsed.data;
}

export function createSupabaseApplicants(client: SupabaseRestClient): ApplicantRepository {
  return {
    async findByToken(token) {
      // Malformed tokens would make Postgres reject the uuid cast; they simply match no seat.
      if (!UUID.test(token)) {
        return null;
      }
      return parse(
        applicantSchema,
        await client.rpc("applicant_by_token", { p_token: token }),
        "applicant_by_token",
      );
    },
    async submit(token, application) {
      if (!UUID.test(token)) {
        return "not_found";
      }
      // Not retried: a lost response may have stored the application; the caller re-reads state instead.
      const body = await client.rpc("submit_application", {
        p_token: token,
        p_agent_name: application.agentName,
        p_ticker: application.ticker,
        p_x_handle: application.xHandle,
        p_category: application.category,
        p_personality: application.personality,
        p_edge: application.edge,
        p_why_you: application.whyYou,
      });
      return parse(outcomeSchema, body, "submit_application");
    },
    async isTickerAvailable(ticker) {
      return parse(
        z.boolean(),
        await client.rpc("ticker_available", { p_ticker: ticker }),
        "ticker_available",
      );
    },
  };
}
