import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AccessDeniedError,
  AuthenticationRequiredError,
  createAuthenticateRequest,
  InactiveWorkspaceError,
  InvalidAccessTokenError,
  type StoredApiKey,
  type Workspace,
} from "../src/index.js";

const ws = (id: string, userId: string | null, isActive = true): Workspace => ({
  id,
  name: id,
  userId,
  isActive,
  activeModules: ["agent"],
});
const NOW = new Date("2026-09-16T12:00:00Z");
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

function setup(
  overrides: {
    keys?: StoredApiKey[];
    memberships?: Record<string, { workspaceId: string; role: string | null }[]>;
  } = {},
) {
  const workspaces = [ws("w-ana", "ana"), ws("w-bo", "bo"), ws("w-off", "off", false)];
  const memberships = overrides.memberships ?? {
    carl: [{ workspaceId: "w-bo", role: "manager" }],
    ana: [{ workspaceId: "w-bo", role: "viewer" }],
  };
  const keys = overrides.keys ?? [];
  return createAuthenticateRequest({
    tokens: {
      async verify(token) {
        if (!token.startsWith("jwt:")) {
          throw new InvalidAccessTokenError();
        }
        return { userId: token.slice(4), email: `${token.slice(4)}@x.io` };
      },
    },
    workspaces: {
      findById: async (id) => workspaces.find((w) => w.id === id) ?? null,
      findOwnedBy: async (userId) => workspaces.find((w) => w.userId === userId) ?? null,
      findOldestMembership: async (userId) => memberships[userId]?.[0] ?? null,
      roleOf: async (userId, id) =>
        workspaces.find((w) => w.id === id)?.userId === userId
          ? "admin"
          : (memberships[userId]?.find((m) => m.workspaceId === id)?.role ?? null),
    },
    apiKeys: { findByHash: async (hash) => keys.find((k) => sha(`raw-${k.id}`) === hash) ?? null },
    sha256Hex: async (v) => sha(v),
    now: () => NOW,
    superAdminEmails: ["ana@x.io"],
  });
}

const creds = (
  c: Partial<{
    bearerToken: string;
    apiKey: string;
    selectedWorkspaceId: string;
    clientIp: string;
  }>,
) => ({
  bearerToken: c.bearerToken ?? null,
  apiKey: c.apiKey ?? null,
  selectedWorkspaceId: c.selectedWorkspaceId ?? null,
  clientIp: c.clientIp ?? "10.0.0.1",
});

test("owners are admins of their own workspace", async () => {
  const { principal, workspace } = await setup()(creds({ bearerToken: "jwt:ana" }));
  assert.equal(workspace?.id, "w-ana");
  assert.equal(principal.kind === "user" && principal.memberRole, "admin");
  assert.equal(principal.kind === "user" && principal.isSuperAdmin, true);
});

test("members resolve to their oldest membership, and may select another workspace they belong to", async () => {
  const auth = setup();
  const member = await auth(creds({ bearerToken: "jwt:carl" }));
  assert.equal(member.workspace?.id, "w-bo");
  assert.equal(member.principal.kind === "user" && member.principal.memberRole, "manager");

  const selected = await auth(creds({ bearerToken: "jwt:ana", selectedWorkspaceId: "w-bo" }));
  assert.equal(selected.workspace?.id, "w-bo");
  assert.equal(selected.principal.kind === "user" && selected.principal.memberRole, "viewer");

  await assert.rejects(
    auth(creds({ bearerToken: "jwt:carl", selectedWorkspaceId: "w-ana" })),
    AccessDeniedError,
  );
});

test("signed-in users without a workspace authenticate without a tenant", async () => {
  const { principal, workspace } = await setup()(creds({ bearerToken: "jwt:newbie" }));
  assert.equal(workspace, null);
  assert.equal(principal.tenantId, null);
});

test("inactive workspaces are rejected", async () => {
  await assert.rejects(setup()(creds({ bearerToken: "jwt:off" })), InactiveWorkspaceError);
});

test("invalid tokens fall back to the API key unless the route is user-only", async () => {
  const key: StoredApiKey = {
    id: "k1",
    scopes: ["integrator"],
    active: true,
    expiresAt: null,
    allowedCidrs: null,
    workspaceId: "w-bo",
    linkExpiresAt: null,
  };
  const auth = setup({ keys: [key] });
  const viaKey = await auth(creds({ bearerToken: "garbage", apiKey: "raw-k1" }));
  assert.equal(viaKey.principal.kind, "apikey");
  assert.equal(viaKey.workspace?.id, "w-bo");
  await assert.rejects(
    auth(creds({ bearerToken: "garbage", apiKey: "raw-k1" }), { userOnly: true }),
    AuthenticationRequiredError,
  );
  await assert.rejects(auth(creds({})), AuthenticationRequiredError);
});

test("API keys: inactive, expired, expired link, unlinked or unknown keys are refused; CIDR violations are forbidden", async () => {
  const base: StoredApiKey = {
    id: "",
    scopes: [],
    active: true,
    expiresAt: null,
    allowedCidrs: null,
    workspaceId: "w-bo",
    linkExpiresAt: null,
  };
  const past = new Date("2026-09-01T00:00:00Z");
  const keys: StoredApiKey[] = [
    { ...base, id: "inactive", active: false },
    { ...base, id: "expired", expiresAt: past },
    { ...base, id: "link-expired", linkExpiresAt: past },
    { ...base, id: "unlinked", workspaceId: null },
    { ...base, id: "cidr", allowedCidrs: ["192.168.0.0/16"] },
    { ...base, id: "off", workspaceId: "w-off" },
  ];
  const auth = setup({ keys });
  for (const id of ["inactive", "expired", "link-expired", "unlinked", "unknown"]) {
    await assert.rejects(auth(creds({ apiKey: `raw-${id}` })), AuthenticationRequiredError, id);
  }
  await assert.rejects(
    auth(creds({ apiKey: "raw-cidr", clientIp: "10.0.0.1" })),
    AccessDeniedError,
  );
  assert.equal(
    (await auth(creds({ apiKey: "raw-cidr", clientIp: "192.168.4.4" }))).principal.id,
    "cidr",
  );
  await assert.rejects(auth(creds({ apiKey: "raw-off" })), InactiveWorkspaceError);
});
