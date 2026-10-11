# Trading baseline operator tooling

Read the service and infrastructure instructions before changing this tooling.
These explicit local commands preserve code, reference material and historical records. They
must dispatch before runtime/provider composition. Offline verification never loads environment
files, PostgreSQL, provider clients or networking code. Restoration creates disposable databases
and directories only; never start applications, schedules or financial sessions from a restore.

Keep artifacts private, exclude credential files, reject symlinks/path traversal and overwrites,
and report missing or unstable inputs as incomplete. Database snapshots and Git archives belong
to the Node-only infrastructure baseline subpath. Do not duplicate trading accounting or alter
strategy registries. Preserve all unresolved PTS parameters.
