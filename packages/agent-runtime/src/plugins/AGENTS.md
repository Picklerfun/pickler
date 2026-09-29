# Harness plugins

The core catalog is authoritative for IDs, versions, permissions, credential names and limits.
`registry.ts` binds each ID exactly once to its reviewed factory module. Each registered plugin
has one directory and an index exposing its composition/capabilities. No dynamic downloads.

Model tools are read-only capabilities. Execution plugins expose operator/service factories,
never tools that let a model choose capital, configuration or credentials. Business rules live
in trading; HTTP/database implementations live in infrastructure. Jev/DeepSeek are model adapters,
not new persisted plugin IDs. Preserve disabled capabilities and historical plugin defaults.

To add a plugin: define its reviewed identity/permissions in core, implement the factory here,
register it, declare necessary DTOs/ports/adapters, and test exact registry coverage, tool schemas,
disabled access and permission enforcement. Never duplicate the catalog in an application.
