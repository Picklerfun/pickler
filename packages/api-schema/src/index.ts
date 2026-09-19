// Public wire format only: no domain objects, secrets, Date or bigint.
export interface HealthResponse {
  status: "ok";
  checkedAt: string;
}

export type * from "./landing.js";
export type * from "./waitlist.js";
export * from "./applications.js";
export type * from "./agents.js";
export type * from "./errors.js";

export * from "./research.js";

export * from "./paper.js";
export * from "./console.js";
