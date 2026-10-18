"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { activeOrg, grantProjectAccess, requireUser } from "@/lib/accounts";
import { createRecord, getRecordBySlug } from "@/lib/store";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "record"
  );
}

export async function createRecordAction(formData: FormData) {
  const user = await requireUser();
  const org = await activeOrg(user.id);
  if (!org) redirect("/records?error=" + encodeURIComponent("Create your company first"));

  const address = String(formData.get("address") ?? "").trim();
  if (!address) return;

  const owner = String(formData.get("owner") ?? "").trim();

  // Slugs are global, so collisions get a suffix rather than an error the
  // contractor has to think about.
  const base = slugify(address);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const clash = await getRecordBySlug(slug);
    if (!clash) break;
    slug = `${base}-${nanoid(4).toLowerCase()}`;
  }

  const id = nanoid(12);
  await createRecord({
    id,
    slug,
    address,
    owner: owner || undefined,
    contractor: org!.name,
    orgId: org!.id,
  });

  await grantProjectAccess({
    recordId: id,
    orgId: org!.id,
    role: "owner",
    addedByUserId: user.id,
  });

  revalidatePath("/records");
  redirect(`/records/${slug}`);
}
