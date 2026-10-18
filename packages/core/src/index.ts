/**
 * @homefax/core — the domain vocabulary every HomeFAX app shares.
 *
 * Nothing in here touches a database or a request. It is the construction
 * sequence, the ledger, the rubric, the catalogue, and the two external
 * instruments (the reconstruction worker and the vision review).
 */
export * from "./types";
export * from "./stages";
export * from "./checkpoints";
export * from "./quality";
export * from "./catalog";
export {
  takeoffFromGeometry,
  partFromDetection,
  cumulativeParts,
  partsSubtotal,
} from "./parts";
export * from "./parts-id";
export * from "./recon";
export * from "./vision";
export * from "./frames";
