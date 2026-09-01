import { NextResponse } from "next/server";
import { canAccessRecord, currentUser } from "@/lib/accounts";
import { advanceCapture } from "@/lib/pipeline";
import { getCapture } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Get the raw capture first so we can check access before advancing state.
  const raw = await getCapture(id);
  if (!raw) return NextResponse.json({ error: "Capture not found." }, { status: 404 });

  const hasAccess = await canAccessRecord(user.id, raw.recordId);
  if (!hasAccess) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

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
