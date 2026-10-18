import { NextResponse } from "next/server";
import { canBuild, records, withActor } from "@homefax/db";
import { kit } from "@/lib/kit";
import { advanceCapture } from "@/lib/pipeline";

/**
 * The phone polls this while the model is being built. The read and the
 * build-right check run as the actor; only then does the pipeline (a named
 * service-level flow) advance the capture.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await kit.currentPrincipal();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const gate = await withActor({ identityId: me.identity.id }, async (tx) => {
    const raw = await records.getCapture(tx, id);
    if (!raw) return null;
    return { allowed: await canBuild(tx, raw.propertyId) };
  });
  if (!gate) return NextResponse.json({ error: "Capture not found." }, { status: 404 });
  if (!gate.allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

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
