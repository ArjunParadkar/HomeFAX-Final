import { notFound } from "next/navigation";
import { properties } from "@homefax/db";
import { ErrorLine } from "@homefax/ui";
import { addDocumentAction, removeDocumentAction } from "../actions";
import AppHeader from "@/components/AppHeader";
import DocumentUpload from "@/components/DocumentUpload";
import { formatBytes, formatDay, plural } from "@/lib/format";
import { addressLine, openHouse } from "@/lib/house";
import { kit } from "@/lib/kit";
import { DOCUMENT_KIND_LABEL, blobConfigured, isDocumentKind } from "@/lib/storage";

/**
 * The paper that goes with the house: permits, warranties, manuals, plans,
 * deeds. Anyone with full scope can read them; the owner and the builder add
 * them; the owner can remove any of them.
 */

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ params, searchParams }: PageProps<"/home/[slug]/documents">) {
  const { slug } = await params;
  const sp = await searchParams;

  const data = await kit.asMe(async (tx, me) => {
    const house = await openHouse(tx, me.identity.id, slug, `/home/${slug}/documents`);
    if (!house) return null;
    const documents = await properties.listDocuments(tx, house.property.id);
    return { house, documents, me };
  });
  if (!data) notFound();

  const { house, documents } = data;

  return (
    <>
      <AppHeader
        back={{ href: `/home/${slug}`, label: addressLine(house.property) }}
        eyebrow="Documents"
        title="Documents"
        subtitle="The paper that goes with the house. Kept with the record, handed on with the keys."
        meta={plural(documents.length, "file")}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">On file</h2>
          </div>
          {documents.length === 0 ? (
            <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Nothing filed yet. Add the permit card, the appliance manuals, the roof warranty — anything you would otherwise keep in a drawer.
            </p>
          ) : (
            <ul>
              {documents.map((d) => (
                <li key={d.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <a href={d.blobUrl} target="_blank" rel="noreferrer" className="block text-[0.9375rem] font-medium leading-snug text-[var(--accent)]">
                      {d.title}
                    </a>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="chip chip-accent">{isDocumentKind(d.kind) ? DOCUMENT_KIND_LABEL[d.kind] : d.kind}</span>
                      <span className="chip">{formatDay(d.createdAt)}</span>
                      {d.sizeBytes != null && <span className="chip">{formatBytes(d.sizeBytes)}</span>}
                      {d.uploadedByOrgId && <span className="chip">from the builder</span>}
                    </span>
                  </span>
                  <form action={removeDocumentAction} className="shrink-0">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <button type="submit" className="chip min-h-[2.75rem] px-3" style={{ color: "var(--grade-f)", borderColor: "color-mix(in oklab, var(--grade-f) 55%, transparent)" }}>
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Add a document</h2>
          </div>
          <DocumentUpload action={addDocumentAction} propertyId={house.property.id} slug={slug} enabled={blobConfigured} />
        </section>
      </main>
    </>
  );
}
