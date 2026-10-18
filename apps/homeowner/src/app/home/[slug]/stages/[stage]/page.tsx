import dynamicImport from "next/dynamic";
import { notFound } from "next/navigation";
import { STAGES, isStageId, stageDef, stageIndex } from "@homefax/core";
import { orgs, oversight, records } from "@homefax/db";
import { PartsTable, QualityPanel } from "@homefax/ui";
import AppHeader from "@/components/AppHeader";
import StageView from "@/components/StageView";
import { formatDay } from "@/lib/format";
import { addressLine, openHouse } from "@/lib/house";
import { kit } from "@/lib/kit";

const ModelViewer = dynamicImport(() => import("@homefax/ui/model-viewer"));

/**
 * One stage of your house: the model, the stamp and ledger, the frames that
 * were kept, what the city said, and what was put in. Read-only — the filming
 * belongs to the contractor app.
 */

export const dynamic = "force-dynamic";

export default async function StagePage({ params }: PageProps<"/home/[slug]/stages/[stage]">) {
  const { slug, stage } = await params;
  if (!isStageId(stage)) notFound();

  const data = await kit.asMe(async (tx, me) => {
    const house = await openHouse(tx, me.identity.id, slug, `/home/${slug}/stages/${stage}`);
    if (!house) return null;
    const captures = await records.listCapturesForProperty(tx, house.property.id);
    const capture = captures.find((c) => c.stage === stage) ?? null;
    const reviews = capture ? (await oversight.listReviewsForProperty(tx, house.property.id)).filter((r) => r.captureId === capture.id) : [];
    const orgNames = await orgs.getOrgsByIds(tx, reviews.map((r) => r.municipalityOrgId));
    return { house, capture, reviews, orgNames };
  });
  if (!data) notFound();

  const { house, capture, reviews, orgNames } = data;
  const def = stageDef(stage);
  const position = stageIndex(stage) + 1;
  const done = capture?.state === "done";

  return (
    <>
      <AppHeader
        back={{ href: `/home/${slug}`, label: addressLine(house.property) }}
        eyebrow={`Stage ${String(position).padStart(2, "0")} of ${STAGES.length}`}
        title={def.label}
        subtitle={def.blurb}
        meta={done && capture ? `Filmed ${formatDay(capture.createdAt)}` : undefined}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <StageView
          capture={capture}
          def={def}
          reviews={reviews.map((r) => ({ ...r, orgName: orgNames.get(r.municipalityOrgId)?.name ?? "The municipality" }))}
          viewer={done && capture?.glbUrl ? <ModelViewer url={capture.glbUrl} className="h-[68vw] max-h-[24rem] w-full" /> : null}
          quality={done && capture?.quality ? <QualityPanel report={capture.quality} stageLabel={def.label} /> : null}
          parts={done && capture ? <PartsTable parts={capture.parts} title="What was put in" note="Every line is from this stage's model and footage, at list prices. The exact make and model, where a label was legible, is what you need when something has to be matched." /> : null}
          neighbours={{
            prev: position > 1 ? { href: `/home/${slug}/stages/${STAGES[position - 2].id}`, label: STAGES[position - 2].short } : null,
            next: position < STAGES.length ? { href: `/home/${slug}/stages/${STAGES[position].id}`, label: STAGES[position].short } : null,
          }}
        />
      </main>
    </>
  );
}
