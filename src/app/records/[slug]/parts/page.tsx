import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PartsTable from "@/components/PartsTable";
import { currentKey } from "@/lib/auth";
import { cumulativeParts } from "@/lib/parts";
import { getRecord, listCaptures } from "@/lib/store";
import type { StageId } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PartsPage({ params }: PageProps<"/records/[slug]/parts">) {
  const key = await currentKey();
  if (!key) redirect("/");

  const { slug } = await params;
  const record = await getRecord(slug, key.id);
  if (!record) notFound();

  const captures = await listCaptures(record.id);
  const parts = cumulativeParts(
    captures
      .filter((c) => c.state === "done")
      .map((c) => ({ stage: c.stage as StageId, parts: c.parts })),
  );

  return (
    <>
      <AppHeader
        back={{ href: `/records/${slug}`, label: record.address }}
        title="Parts list"
        subtitle="Everything the record has accounted for so far"
      />
      <main className="shell flex-1 py-6">
        <section className="card overflow-hidden">
          <PartsTable parts={parts} />
        </section>
        <p className="mt-4 text-xs leading-relaxed text-[var(--ink-3)]">
          Quantities carry the reasoning that produced them. Measured lines come off the 3D model,
          counted lines come from the footage, and derived lines follow from a measured quantity by
          a stated rule. Nothing here is a guess presented as a fact — check the derivation before
          you order.
        </p>
      </main>
    </>
  );
}
