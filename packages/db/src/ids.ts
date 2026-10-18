import { customAlphabet } from "nanoid";

/** URL-safe, no look-alikes, 12 chars ≈ 71 bits. Every row id in the platform. */
export const newId = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", 12);

export function slugify(input: string, max = 64): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max)
      .replace(/-$/, "") || "x"
  );
}
