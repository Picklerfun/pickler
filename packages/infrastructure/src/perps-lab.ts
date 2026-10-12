/** Explicit local persistence composition; no model or signing adapter is loaded. */
export { PostgresResearchStore } from "./persistence/research-store.js";
export { PostgresPerpsPaperStore } from "./persistence/perps-paper-store.js";
export { PostgresPerpsStudyStore } from "./persistence/perps-study-store.js";
export { exportPerpsAudit, exportPerpsAuditParts } from "./persistence/perps-audit-export.js";
export type { PerpsAuditPart } from "./persistence/perps-audit-export.js";
export { guardPerpsLabPool } from "./persistence/perps-lab-pool.js";
export type { PerpsLabFailureDiagnostic } from "./persistence/perps-lab-pool.js";
