> Historical validation before the removal of Hyperdrive. See the subsequent direct-connection validation record for current results.

# Local unification validation

Validation date: 2026-09-19. These results cover local PostgreSQL/Supabase and workerd.
They do not establish remote deployment, Hyperdrive behavior or live-provider acceptance.

## Automated checks

- 243 tests passed against isolated databases on the local Supabase instance.
- Migration coverage includes empty, prior research and prior product histories.
- Controlled tests cover JWT-only console authorization, operator revocation, concurrent
  provisioning, ownership, PostgreSQL budgets, leases, scheduling and plugin isolation.
- Type checking passed across ten workspaces; lint passed.
- OpenNext web, Hono API and research Queue Worker deployment dry runs passed.
- The staging topology check accepts local placeholder builds and rejects provisioned mode
  until real dedicated resource identifiers have been supplied.

## Browser against compiled Workers

The browser used `http://127.0.0.1:8780`, with all three Workers connected through local
Wrangler bindings. The research consumer had admissions disabled throughout; no model or
research-provider request was made.

Verified through actual forms and persisted responses:

1. Landing waitlist submission, HttpOnly application-cookie transport, server-rendered
   application access, ticker availability and successful creator-application submission.
2. Email signup, handle availability, profile creation and personal-workspace provisioning.
3. New accounts show research access pending and cannot create agents until explicitly enabled.
4. Two enabled disposable users create separate agents: American football and soccer.
   The second user's console does not list the first user's agent.
5. A manual research is admitted and shown as queued through polling. Pausing its agent disables
   further launch and leaves the pending job blocked; it is not a completed investigation.
6. Enabling a schedule before connection/manual validation returns NOT_READY and preserves the
   disabled schedule. The console now translates this into an actionable message.
7. Logout returns to sign-in. Reloading the authenticated console restores its workspace.

Browser testing found and corrected the local PostgREST allowlist mismatch: product routes
need the six product schemas exposed with their existing grants/RLS. Research and internal
schemas stay private. Signup/demo text was also corrected to avoid implying automatic wallet
creation, betting or public research publication.

## Still required remotely

- Dedicated Supabase project access, Cloudflare resource provisioning and secret configuration.
- Cache-disabled Hyperdrive transaction/read-after-write verification.
- Auth callback, secure cookies and session renewal on the HTTPS staging origin.
- At most two manual and one scheduled real research, attribution/evidence/usage verification,
  followed by paused schedules. No paid acceptance executions have been used in this work.
- Deployment URL, exact commit and Worker versions, and rollback verification.
