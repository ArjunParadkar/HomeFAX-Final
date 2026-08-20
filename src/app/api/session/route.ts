import { NextResponse } from "next/server";
import { KEY_COOKIE, accessKeys, verifyKey } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { key?: string };
  const key = verifyKey(body.key ?? "");

  if (!key) {
    // A misconfigured deployment and a wrong key are different problems.
    if (accessKeys().length === 0) {
      return NextResponse.json(
        { error: "No access keys are configured on this deployment yet." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "That key was not recognised." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, label: key.label });
  res.cookies.set(KEY_COOKIE, key.secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(KEY_COOKIE);
  return res;
}
