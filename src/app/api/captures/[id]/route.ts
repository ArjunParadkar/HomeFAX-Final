import { NextResponse } from "next/server";
import { currentKey } from "@/lib/auth";
import { advanceCapture } from "@/lib/pipeline";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const key = await currentKey();
  if (!key) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const capture = await advanceCapture(id);
  if (!capture) return NextResponse.json({ error: "Capture not found." }, { status: 404 });

  return NextResponse.json({
    id: capture.id,
    stage: capture.stage,
    state: capture.state,
    job: capture.job,
    glbUrl: capture.glbUrl,
    score: capture.score,
  });
}
