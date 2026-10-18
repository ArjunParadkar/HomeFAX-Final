"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, optStr, str } from "@homefax/app-kit";
import { oversight, records, type InspectionReview } from "@homefax/db";
import { asWorkspace } from "@/lib/workspace";

const VERDICTS = new Set(["verified", "flagged", "site_visit"]);

/**
 * Fields: captureId, verdict (verified|flagged|site_visit), notes, permitId (optional).
 * Municipality members only, and only inside their jurisdiction — RLS enforces
 * both. Re-reviewing replaces the earlier verdict. → /inspections
 */
export async function recordReviewAction(fd: FormData): Promise<void> {
  const captureId = str(fd, "captureId");
  const verdict = str(fd, "verdict");
  const back = `/inspections/${captureId}`;
  if (!VERDICTS.has(verdict)) fail(back, "Choose verified, flagged, or site visit");
  try {
    await asWorkspace(async (tx, ws) => {
      const cap = await records.getCapture(tx, captureId);
      if (!cap) throw new Error("Capture not found");
      await oversight.recordInspectionReview(tx, {
        captureId,
        propertyId: cap.propertyId,
        municipalityOrgId: ws.org.id,
        permitId: optStr(fd, "permitId"),
        reviewerId: ws.me.identity.id,
        verdict: verdict as InspectionReview["verdict"],
        notes: optStr(fd, "notes"),
        orgName: ws.org.name,
        stage: cap.stage,
      });
    });
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath("/inspections");
  revalidatePath("/dashboard");
  revalidatePath(back);
  redirect(`/inspections?ok=${verdict}`);
}
