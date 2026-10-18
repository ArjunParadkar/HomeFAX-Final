import Link from "next/link";
import { ErrorLine, Wordmark } from "@homefax/ui";
import { orgs, withService } from "@homefax/db";
import { acceptInvitationAction } from "@/app/join/[token]/actions";
import AuthForms from "@/components/AuthForms";
import { KIND_LABEL, isWorkspaceKind } from "@/lib/workspace";
import { kit } from "@/lib/kit";

export const dynamic = "force-dynamic";

/**
 * Accept an invitation. The lookup runs as the service (the repo says so —
 * the invitee cannot read the row yet) and shows only the institution's name.
 * Sign in or create an account first; the auth forms bring you back here.
 */
export default async function JoinPage({ params, searchParams }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const me = await kit.currentPrincipal();
  const found = await withService((tx) => orgs.findInvitation(tx, token));
  const here = `/join/${encodeURIComponent(token)}`;
  const raw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const mode = raw === "signup" ? "signup" : "signin";

  return (
    <main className="mx-auto w-full max-w-[30rem] flex-1 px-5 py-8 lg:py-12">
      <Link href="/" aria-label="HomeFAX" className="mb-6 flex min-h-[2.25rem] items-center">
        <Wordmark size={17} tracking={0.16} />
      </Link>

      {!found ? (
        <section className="card px-5 py-5">
          <p className="eyebrow">Invitation</p>
          <h1 className="mt-1.5 text-[1.25rem] font-semibold leading-tight">This invitation is not valid or has expired</h1>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">Invitations last seven days. Ask the person who invited you for a fresh link from their Team page.</p>
          <Link href="/" className="btn btn-secondary mt-4 w-full">
            Go to sign in
          </Link>
        </section>
      ) : (
        <>
          <section className="card px-5 py-5">
            <p className="eyebrow">You are invited to join</p>
            <h1 className="mt-1.5 text-[1.375rem] font-semibold leading-tight">{found.org.name}</h1>
            <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
              {isWorkspaceKind(found.org.kind) ? KIND_LABEL[found.org.kind] : orgs.ORG_KIND_LABEL[found.org.kind]}
              {found.org.headline ? ` · ${found.org.headline}` : ""} · as {found.invitation.role === "admin" ? "an admin" : "a member"}
              {found.invitation.title ? ` (${found.invitation.title})` : ""}
            </p>
            {me ? (
              <form action={acceptInvitationAction} className="mt-4 space-y-3">
                <input type="hidden" name="token" value={token} />
                <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                  Signed in as <span className="font-medium text-[var(--ink)]">{me.profile.name}</span> ({me.identity.email}).
                </p>
                <ErrorLine message={sp.error} />
                <button type="submit" className="btn btn-primary w-full">
                  Join {found.org.name}
                </button>
              </form>
            ) : (
              <p className="mt-3 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">Sign in, or create your account, and you will come straight back here to accept.</p>
            )}
          </section>
          {!me && (
            <div className="mt-5">
              <AuthForms mode={mode} error={sp.error} next={here} basePath={here} />
            </div>
          )}
        </>
      )}
    </main>
  );
}
