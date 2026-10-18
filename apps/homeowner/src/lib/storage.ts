/** Documents go browser → Blob directly; the server only mints the upload token. */
export const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export const DOCUMENT_KINDS = [
  "permit",
  "plan",
  "warranty",
  "invoice",
  "inspection",
  "insurance",
  "deed",
  "manual",
  "photo",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  permit: "Permit",
  plan: "Plan",
  warranty: "Warranty",
  invoice: "Invoice",
  inspection: "Inspection",
  insurance: "Insurance",
  deed: "Deed",
  manual: "Manual",
  photo: "Photo",
  other: "Other",
};

export function isDocumentKind(v: string): v is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(v);
}
