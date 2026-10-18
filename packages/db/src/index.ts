/**
 * @homefax/db — the platform database.
 *
 *   withActor(actor, tx => …)   run as a person; RLS decides what they see
 *   withService(tx => …)        run as the platform (login, pipeline, imports)
 *   repos.*                     typed operations, each taking the transaction first
 *
 * Read packages/db/README.md for the model and the access rules.
 */
export * from "./client";
export * from "./ids";
export * from "./address";
export * as schema from "./schema";
export * from "./schema";

export * as auth from "./repos/auth";
export * as people from "./repos/people";
export * as orgs from "./repos/orgs";
export * as properties from "./repos/properties";
export * as records from "./repos/records";
export * as access from "./repos/access";
export * as oversight from "./repos/oversight";
export * as audit from "./repos/audit";
