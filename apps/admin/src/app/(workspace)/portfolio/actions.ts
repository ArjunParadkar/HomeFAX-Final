"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cents, errorMessage, fail, num, optStr, str } from "@homefax/app-kit";
import { isStageId } from "@homefax/core";
import { oversight, type LoanDraw, type PortfolioHolding } from "@homefax/db";
import { asWorkspace } from "@/lib/workspace";

const HOLDING_KINDS = new Set(["construction", "mortgage", "heloc", "bridge", "commercial"]);
const HOLDING_STATUS = new Set(["pipeline", "active", "paid_off", "default", "sold"]);

function safeBack(v: string | null, fallback: string): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

/** Fields: propertyId, kind, loanRef, principal ($), rateBps or rate (%), originatedAt, maturesAt, notes. Lender members only (RLS). → /portfolio */
export async function createHoldingAction(fd: FormData): Promise<void> {
  const propertyId = str(fd, "propertyId");
  const kind = str(fd, "kind");
  const principalCents = cents(fd, "principal");
  const rate = num(fd, "rate");
  if (!propertyId) fail("/portfolio", "Pick the property");
  if (!HOLDING_KINDS.has(kind)) fail("/portfolio", "Pick the kind of loan");
  if (principalCents == null) fail("/portfolio", "Enter the principal as a dollar amount");
  try {
    await asWorkspace((tx, ws) =>
      oversight.createHolding(tx, {
        orgId: ws.org.id,
        propertyId,
        kind: kind as PortfolioHolding["kind"],
        loanRef: optStr(fd, "loanRef"),
        principalCents,
        rateBps: rate == null ? null : Math.round(rate * 100),
        originatedAt: optStr(fd, "originatedAt"),
        maturesAt: optStr(fd, "maturesAt"),
        notes: optStr(fd, "notes"),
        createdBy: ws.me.identity.id,
      }),
    );
  } catch (e) {
    fail("/portfolio", errorMessage(e));
  }
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  redirect("/portfolio");
}

/** Fields: holdingId, status. → /portfolio */
export async function updateHoldingStatusAction(fd: FormData): Promise<void> {
  const id = str(fd, "holdingId");
  const status = str(fd, "status");
  if (!HOLDING_STATUS.has(status)) fail("/portfolio", "Pick a status");
  try {
    await asWorkspace((tx) => oversight.updateHolding(tx, id, { status: status as PortfolioHolding["status"] }));
  } catch (e) {
    fail("/portfolio", errorMessage(e));
  }
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  redirect("/portfolio");
}

/** Fields: holdingId, stage, amount ($), back. The house follows the holding. Records a draw request; the recommendation is computed and stored. → back | /draws */
export async function requestDrawAction(fd: FormData): Promise<void> {
  const holdingId = str(fd, "holdingId");
  const stage = str(fd, "stage");
  const amountCents = cents(fd, "amount");
  const back = safeBack(optStr(fd, "back"), "/draws");
  if (!isStageId(stage)) fail(back, "Pick the stage this draw funds");
  if (amountCents == null) fail(back, "Enter the draw amount");
  try {
    await asWorkspace(async (tx, ws) => {
      const holding = await oversight.getHolding(tx, holdingId);
      if (!holding || holding.orgId !== ws.org.id) throw new Error("Holding not found");
      await oversight.requestDraw(tx, { holdingId, propertyId: holding.propertyId, stage, amountCents, requestedBy: ws.me.identity.id });
    });
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath("/draws");
  revalidatePath("/dashboard");
  redirect(back);
}

/** Fields: drawId, status (released|held|rejected|verified), note, back. The decision is logged on the house's timeline. → back */
export async function decideDrawAction(fd: FormData): Promise<void> {
  const id = str(fd, "drawId");
  const status = str(fd, "status");
  const note = optStr(fd, "note");
  const back = safeBack(optStr(fd, "back"), "/draws");
  if (!["released", "held", "rejected", "verified"].includes(status)) fail(back, "Choose release, hold, or reject");
  try {
    await asWorkspace((tx, ws) => oversight.decideDraw(tx, id, status as Exclude<LoanDraw["status"], "requested">, ws.me.identity.id, note, ws.org.name));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath("/draws");
  revalidatePath("/dashboard");
  revalidatePath(`/draws/${id}`);
  redirect(back);
}
