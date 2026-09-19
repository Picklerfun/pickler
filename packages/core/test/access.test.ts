import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import {
  abilitiesForApiKey,
  abilitiesForMemberRole,
  buildAgentPrincipal,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  checkPermission,
  hasActiveModule,
  isIpAllowed,
  parseEmailAllowlist,
  type Actions,
  type Subjects,
} from "../src/index.js";

test("CIDR cases from Relayer's spec", () => {
  assert.equal(isIpAllowed("192.168.1.5", ["192.168.1.0/24"]), true);
  assert.equal(isIpAllowed("10.0.0.1", ["192.168.1.0/24"]), false);
  assert.equal(isIpAllowed("10.0.0.1", null), true);
  assert.equal(isIpAllowed("10.0.0.1", []), true);
  assert.equal(isIpAllowed("::ffff:192.168.1.5", ["192.168.1.0/24"]), true);
  assert.equal(isIpAllowed("192.168.1.5", ["192.168.1.0/24", "10.0.0.0/8"]), true);
  assert.equal(isIpAllowed("172.16.0.1", ["192.168.1.0/24", "10.0.0.0/8"]), false);
  assert.equal(isIpAllowed("10.0.0.1", ["10.0.0.1/32"]), true);
  assert.equal(isIpAllowed("10.0.0.2", ["10.0.0.1/32"]), false);
});

test("CIDR matching agrees with node's net.BlockList, which Relayer used", () => {
  const cases: [string, string][] = [
    ["2001:db8::1", "2001:db8::/32"],
    ["2001:db9::1", "2001:db8::/32"],
    ["::1", "::1/128"],
    ["fe80::1:2", "fe80::/10"],
    ["2001:db8:0:0:0:0:0:1", "2001:db8::/64"],
    ["0.0.0.0", "0.0.0.0/0"],
    ["255.255.255.255", "255.255.255.254/31"],
    ["10.1.2.3", "10.0.0.0/15"],
    ["10.2.0.0", "10.0.0.0/15"],
  ];
  for (const [ip, cidr] of cases) {
    const [base, prefix] = cidr.split("/");
    const family = net.isIPv4(base!) ? "ipv4" : "ipv6";
    const list = new net.BlockList();
    list.addSubnet(base!, Number(prefix), family);
    assert.equal(isIpAllowed(ip, [cidr]), list.check(ip, family), `${ip} in ${cidr}`);
  }
});

test("malformed CIDRs and addresses fail closed", () => {
  assert.equal(isIpAllowed("10.0.0.1", ["10.0.0.0"]), false);
  assert.equal(isIpAllowed("10.0.0.1", ["10.0.0.0/33"]), false);
  assert.equal(isIpAllowed("10.0.0.1", ["nope/8"]), false);
  assert.equal(isIpAllowed("not-an-ip", ["0.0.0.0/0"]), false);
  assert.equal(isIpAllowed("010.0.0.1", ["10.0.0.0/8"]), false);
  assert.equal(isIpAllowed("10.0.0.1", ["garbage", "10.0.0.0/8"]), true);
});

const matrix: Record<string, [Actions, Subjects, boolean][]> = {
  admin: [
    ["manage", "Agent", true],
    ["manage", "Admin", true],
    ["read", "AuditLog", true],
  ],
  manager: [
    ["read", "Agent", true],
    ["manage", "Agent", false],
    ["create", "Signing", true],
    ["delete", "Action", false],
    ["read", "AuditLog", false],
    ["read", "SignoffRules", false],
  ],
  developer: [
    ["read", "Signing", true],
    ["manage", "ApiKeys", true],
    ["create", "Signing", false],
    ["read", "AuditLog", false],
  ],
  auditor: [
    ["read", "AuditLog", true],
    ["read", "Agent", true],
    ["manage", "Admin", false],
    ["update", "Signing", false],
  ],
  viewer: [
    ["read", "Signing", true],
    ["read", "Agent", false],
    ["read", "AuditLog", false],
  ],
  stranger: [["read", "Signing", false]],
};

test("member role grants match Relayer's matrix", () => {
  for (const [role, checks] of Object.entries(matrix)) {
    const ability = abilitiesForMemberRole(role);
    for (const [action, subject, expected] of checks) {
      assert.equal(ability.can(action, subject), expected, `${role} ${action} ${subject}`);
    }
  }
});

test("API keys never manage, even with a manage:* scope stored", () => {
  const ability = abilitiesForApiKey(["manage:team", "manage:all", "read:wallets", "sign:prepare"]);
  assert.equal(ability.can("read", "Signing"), true);
  assert.equal(ability.can("create", "Signing"), true);
  assert.equal(ability.can("manage", "Team"), false);
  assert.equal(ability.can("manage", "all"), false);
});

test("principals and permission decisions follow Relayer's guard", () => {
  const required = { action: "manage", subject: "Agent" } as const;
  const owner = buildUserPrincipal({
    user: { id: "u1", email: "Ana@x.io" },
    integrator: { id: "i1" },
    memberRole: "admin",
    superAdminEmails: parseEmailAllowlist(" ana@x.io , "),
  });
  assert.equal(owner.isSuperAdmin, true);
  assert.deepEqual(checkPermission(owner, required), { allowed: true });

  const noTenant = buildUserPrincipal({ user: { id: "u2" } });
  assert.deepEqual(checkPermission(noTenant, required), {
    allowed: false,
    reason: "No integrator context",
  });
  assert.equal(noTenant.isSuperAdmin, false);

  const notMember = buildUserPrincipal({ user: { id: "u3" }, integrator: { id: "i1" } });
  assert.deepEqual(checkPermission(notMember, required), {
    allowed: false,
    reason: "Not a member",
  });

  const manager = buildUserPrincipal({
    user: { id: "u4" },
    integrator: { id: "i1" },
    memberRole: "manager",
  });
  assert.equal(checkPermission(manager, required).allowed, false);

  const scopedKey = buildApiKeyPrincipal({ id: "k1", scopes: ["integrator"] }, "i1");
  assert.equal(scopedKey.kind, "apikey");
  assert.equal(checkPermission(scopedKey, required).allowed, false);

  const adminKey = buildApiKeyPrincipal(
    { id: "k2", scopes: ["admin", "internal", "read:wallets"] },
    "i1",
  );
  assert.equal(adminKey.kind, "service");
  assert.equal(checkPermission(adminKey, required).allowed, false);
  assert.equal(checkPermission(adminKey, { action: "read", subject: "Signing" }).allowed, true);

  assert.equal(
    checkPermission(
      buildAgentPrincipal({ id: "a1", integrator_id: "i1", status: "active" }),
      required,
    ).allowed,
    true,
  );
  assert.equal(checkPermission(null, required).allowed, false);
  assert.equal(checkPermission(null, null).allowed, true);
});

test("core modules are always active and required modules use OR", () => {
  assert.equal(hasActiveModule(["signing"], []), true);
  assert.equal(hasActiveModule(["agent"], ["action"]), false);
  assert.equal(hasActiveModule(["agent", "action"], ["action"]), true);
  assert.equal(hasActiveModule([], null), true);
});

test("API keys require explicit permissions and workspace context", () => {
  const read = { action: "read", subject: "Agent" } as const;
  for (const scopes of [
    [],
    ["read:wallets"],
    ["integrator"],
    ["internal"],
    ["admin"],
    ["unknown"],
  ]) {
    assert.equal(
      checkPermission(buildApiKeyPrincipal({ id: "k", scopes }, "w1"), read).allowed,
      false,
    );
  }
  const key = buildApiKeyPrincipal({ id: "k", scopes: ["read:agents"] }, "w1");
  assert.equal(checkPermission(key, read).allowed, true);
  assert.equal(checkPermission(key, { action: "update", subject: "Agent" }).allowed, false);
  assert.equal(
    checkPermission(buildApiKeyPrincipal({ id: "k", scopes: ["read:agents"] }, null), read).allowed,
    false,
  );
});
