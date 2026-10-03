import * as dto from "@pickler/api-schema";
import { operation } from "../openapi/operation";
import type { createProfileService, Profile } from "@pickler/core";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { successEnvelope } from "../http/envelope";
import { badRequest, HttpError } from "../http/http-error";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface ProfileRouteServices {
  authenticate: Authenticate;
  profiles: ReturnType<typeof createProfileService>;
  onboard?(userId: string): Promise<void>;
}

const profileDto = (profile: Profile) => ({
  user_id: profile.userId,
  display_name: profile.displayName,
  handle: profile.handle,
  created_at: profile.createdAt.toISOString(),
});

export function handleRoutes(services: ProfileRouteServices) {
  // Public: the sign-up form checks availability before an account exists.
  return new Hono<AppEnv>().get(
    "/:handle/availability",
    operation("handlesAvailability", {
      response: dto.envelopeSchema(dto.handleAvailabilitySchema),
    }),
    async (c) => {
      const raw = c.req.param("handle");
      if (raw.length > 64) {
        throw badRequest("Handle too long");
      }
      return c.json(successEnvelope(await services.profiles.checkHandle(raw), c.req.path), 200, {
        "Cache-Control": "no-store",
      });
    },
  );
}

export function profileRoutes(services: ProfileRouteServices) {
  const signedIn = authenticated(services.authenticate, { userOnly: true });
  return new Hono<AppEnv>()
    .get(
      "/",
      operation("profileGet", {
        response: dto.envelopeSchema(dto.profileSchema),
        security: "user",
      }),
      signedIn,
      async (c) => {
        const profile = await services.profiles.getProfile(c.get("principal").id);
        if (!profile) {
          throw new HttpError(404, "Profile not found");
        }
        return c.json(successEnvelope(profileDto(profile), c.req.path, "Profile retrieved"));
      },
    )
    .post(
      "/",
      operation("profileCreate", {
        response: dto.envelopeSchema(dto.profileSchema),
        body: dto.profileRequestSchema,
        security: "user",
        status: 201,
      }),
      signedIn,
      async (c) => {
        const body = (await c.req.json().catch(() => null)) as {
          display_name?: unknown;
          handle?: unknown;
        } | null;
        if (!body || typeof body.display_name !== "string" || typeof body.handle !== "string") {
          throw badRequest("Fields 'display_name' and 'handle' must be strings");
        }
        const principal = c.get("principal");
        // A studio (email or Google) account needs its master wallet first; a wallet sign-in account
        // claiming a handle from the marketplace has its own wallet and never a custody account. Only
        // the token's server-only app_metadata marker says which — never the email's domain, which
        // anyone can register while email sign-up is open.
        const account = principal.kind === "user" && principal.walletAccount ? "wallet" : "studio";
        const profile = await services.profiles.createProfile(
          principal.id,
          { displayName: body.display_name, handle: body.handle },
          account,
        );
        await services.onboard?.(c.get("principal").id);
        return c.json(successEnvelope(profileDto(profile), c.req.path, "Profile created"), 201);
      },
    );
}
