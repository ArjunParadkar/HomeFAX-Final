import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { canAccessRecord, currentUser } from "@/lib/accounts";
import { submitRecon } from "@/lib/recon";
import { isStageId } from "@/lib/stages";
import { getRecordBySlug, upsertCapture } from "@/lib/store";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    recordId?: string;
    slug?: string;
    stage?: string;
    imageUrls?: string[];
    videoUrl?: string;
  };

  if (!body.stage || !isStageId(body.stage)) {
    return NextResponse.json({ error: "A valid stage is required." }, { status: 400 });
  }

  // Support both recordId and legacy slug lookup
  let record: Awaited<ReturnType<typeof getRecordBySlug>> = null;
  if (body.recordId) {
    const { getRecordById } = await import("@/lib/store");
    record = await getRecordById(body.recordId);
  } else if (body.slug) {
    record = await getRecordBySlug(body.slug);
  }

  if (!record) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  const hasAccess = await canAccessRecord(user.id, record.id);
  if (!hasAccess) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let jobId: string;
  try {
    jobId = await submitRecon({
      stage: body.stage,
      imageUrls: body.imageUrls,
      videoUrl: body.videoUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const id = nanoid(12);
  await upsertCapture({
    id,
    recordId: record.id,
    stage: body.stage,
    jobId,
    state: "queued",
    sourceUrl: body.videoUrl ?? body.imageUrls?.[0] ?? null,
    frames: body.imageUrls ?? [],
  });

  return NextResponse.json({ id, jobId });
}
