import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { kit } from "@/lib/kit";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES } from "@/lib/storage";

/**
 * Documents go from the phone straight to Blob storage; this route only hands
 * out a scoped, short-lived upload token to a signed-in homeowner. Nothing
 * large passes through the function. The row is filed by `addDocumentAction`
 * once the upload completes, under row-level security.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const me = await kit.currentPrincipal();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: DOCUMENT_CONTENT_TYPES,
        addRandomSuffix: true,
        maximumSizeInBytes: DOCUMENT_MAX_BYTES,
        tokenPayload: JSON.stringify({ identityId: me.identity.id }),
      }),
      onUploadCompleted: async () => {
        // The document row is written by the server action with the URL.
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
