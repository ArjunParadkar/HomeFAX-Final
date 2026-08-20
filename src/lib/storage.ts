import { put } from "@vercel/blob";

export const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/**
 * Captures are large (a two-minute 1080p walk is 150-300 MB) so they never pass
 * through a serverless function body. The browser uploads straight to Blob and
 * hands the resulting URL to the API.
 */
export async function uploadBuffer(
  path: string,
  data: Buffer | Blob,
  contentType: string,
) {
  if (!blobConfigured) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set — file storage is unavailable.");
  }
  const res = await put(path, data, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return res.url;
}
