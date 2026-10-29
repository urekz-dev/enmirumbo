// Drizzle schema entry point (docs/specs/data-model.md, ADR 0006). Export
// every table from here so `drizzle.config.ts` and `withDb` both see it.
export * from "./locality.ts";
export * from "./catalogue.ts";
export * from "./business.ts";
export * from "./audit-log.ts";
export * from "./access.ts";
export * from "./settings.ts";
export * from "./media.ts";
export * from "./notifications.ts";
