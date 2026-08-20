import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { currentKey } from "@/lib/auth";
import { submitRecon } from "@/lib/recon";
import { isStageId } from "@/lib/stages";
import { getRecord, upsertCapture } from "@/lib/store";

export async function POST(request: Request) {
  const key = await currentKey();
  if (!key) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    stage?: string;
    imageUrls?: string[];
    videoUrl?: string;
  };

  if (!body.slug || !body.stage || !isStageId(body.stage)) {
    return NextResponse.json({ error: "A record slug and a valid stage are required." }, { status: 400 });
  }

  const record = await getRecord(body.slug, key.id);
  if (!record) return NextResponse.json({ error: "Record not found." }, { status: 404 });

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
