import { NextResponse } from "next/server";
import { isStageId, submitRecon } from "@homefax/core";
import { canBuild, records, withActor } from "@homefax/db";
import { kit } from "@/lib/kit";
import { orgContext } from "@/lib/session";

/**
 * The phone has selected and uploaded its frames; this opens the capture and
 * hands the job to the reconstruction worker. Access is the project team's
 * build right on the property, decided by row-level security's can_build.
 */
export async function POST(request: Request) {
  const me = await kit.currentPrincipal();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    recordId?: string;
    slug?: string;
    stage?: string;
    imageUrls?: string[];
    videoUrl?: string;
  };
  const stage = body.stage;
  if (!stage || !isStageId(stage)) {
    return NextResponse.json({ error: "A valid stage is required." }, { status: 400 });
  }

  const found = await withActor({ identityId: me.identity.id }, async (tx) => {
    const record = body.recordId
      ? await records.getRecord(tx, body.recordId)
      : body.slug
        ? (await records.getRecordBySlug(tx, body.slug))?.record ?? null
        : null;
    if (!record) return null;
    const allowed = await canBuild(tx, record.propertyId);
    const { org } = await orgContext(tx, me);
    return { record, allowed, orgId: org?.id ?? null };
  });
  if (!found) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  if (!found.allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let jobId: string;
  try {
    jobId = await submitRecon({ stage, imageUrls: body.imageUrls, videoUrl: body.videoUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const capture = await withActor({ identityId: me.identity.id }, (tx) =>
    records.upsertCapture(tx, {
      record: found.record,
      stage,
      jobId,
      state: "queued",
      sourceUrl: body.videoUrl ?? body.imageUrls?.[0] ?? null,
      frames: body.imageUrls ?? [],
      filmedBy: me.identity.id,
      filmedByOrgId: found.orgId,
    }),
  );

  return NextResponse.json({ id: capture.id, jobId });
}
