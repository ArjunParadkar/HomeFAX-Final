"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, DOCUMENT_MAX_BYTES } from "@/lib/storage";

/**
 * Adding a document to the house. The file goes from the browser straight to
 * Blob storage (the same client-upload path the contractor app uses for
 * frames); only the resulting URL is posted to the server action, so nothing
 * large ever passes through a function body. The form itself stays a plain
 * form — the client code only fills in the three hidden fields.
 */
export default function DocumentUpload({
  action,
  propertyId,
  slug,
  enabled,
}: {
  action: (formData: FormData) => Promise<void>;
  propertyId: string;
  slug: string;
  enabled: boolean;
}) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "uploading"; name: string } | { kind: "error"; message: string }>({
    kind: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  if (!enabled) {
    return (
      <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
        File storage is not configured on this deployment, so documents cannot be uploaded here yet.
        Your builder&apos;s uploads and the rest of the record are unaffected.
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setState({ kind: "error", message: "Choose a file first" });
      return;
    }
    if (!DOCUMENT_CONTENT_TYPES.includes(file.type)) {
      setState({ kind: "error", message: "PDF, JPG, or PNG only" });
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      setState({ kind: "error", message: "That file is over 25 MB" });
      return;
    }
    setState({ kind: "uploading", name: file.name });
    try {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
      const result = await upload(`documents/${slug}/${Date.now()}-${safe}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
      });
      const out = new FormData();
      out.set("propertyId", propertyId);
      out.set("kind", String(fd.get("kind") ?? "other"));
      out.set("title", String(fd.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, ""));
      out.set("blobUrl", result.url);
      out.set("contentType", file.type);
      out.set("sizeBytes", String(file.size));
      await action(out);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3.5 px-4 py-4">
      <div>
        <label className="label block" htmlFor="doc-file">
          File
        </label>
        <label
          htmlFor="doc-file"
          className="btn btn-secondary mt-1.5 w-full cursor-pointer text-[0.875rem]"
        >
          {fileName ?? "Choose a PDF, JPG, or PNG"}
        </label>
        <input
          id="doc-file"
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Up to 25 MB.</p>
      </div>
      <div>
        <label className="label block" htmlFor="doc-title">
          Title <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input id="doc-title" name="title" placeholder="Taken from the file name if blank" className="input mt-1.5" />
      </div>
      <div>
        <label className="label block" htmlFor="doc-kind">
          Kind
        </label>
        <select id="doc-kind" name="kind" defaultValue="other" className="input mt-1.5">
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="text-[0.8125rem] leading-relaxed" style={{ color: "var(--grade-f)" }}>
          {state.message}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={state.kind === "uploading"}>
        {state.kind === "uploading" ? `Uploading ${state.name}…` : "Add to the record"}
      </button>
    </form>
  );
}
