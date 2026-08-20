"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireKey } from "@/lib/auth";
import { createRecord, getRecord } from "@/lib/store";

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
  const key = await requireKey();

  const address = String(formData.get("address") ?? "").trim();
  if (!address) return;

  const owner = String(formData.get("owner") ?? "").trim();

  // Slugs are shared across every key, so collisions get a suffix rather than
  // an error the contractor has to think about.
  const base = slugify(address);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const clash = await getRecord(slug, key.id);
    if (!clash) break;
    slug = `${base}-${nanoid(4).toLowerCase()}`;
  }

  await createRecord({
    id: nanoid(12),
    slug,
    address,
    owner: owner || undefined,
    contractor: key.label,
    keyId: key.id,
  });

  revalidatePath("/records");
  redirect(`/records/${slug}`);
}
