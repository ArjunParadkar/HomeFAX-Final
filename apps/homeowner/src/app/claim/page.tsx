import Link from "next/link";
import { ErrorLine, LogoMark } from "@homefax/ui";
import { claimAction } from "./actions";
import ClaimCodeInput from "@/components/ClaimCodeInput";
import { kit } from "@/lib/kit";

/**
 * The third way in. A signed-in person types the code and the house joins their
 * record; a stranger also gives a name, an email and a password, and the
 * account and the house arrive together.
 */

export const dynamic = "force-dynamic";

export default async function ClaimPage({ searchParams }: PageProps<"/claim">) {
  const me = await kit.currentPrincipal();
  const sp = await searchParams;
  const code = Array.isArray(sp.code) ? sp.code[0] : sp.code;

  return (
    <main className="shell flex flex-1 flex-col py-8">
      <Link href={me ? "/home" : "/"} className="-ml-2 flex min-h-[2.75rem] w-fit items-center gap-1 rounded-[10px] px-2 text-[0.875rem] font-medium text-[var(--ink-2)]">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {me ? "Your homes" : "Back"}
      </Link>

      <section className="plate mt-3 overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-4 pt-6">
          <LogoMark variant="logo" mode="still" surface="dark" size={96} />
          <p className="eyebrow mt-2">Claim your house</p>
          <h1 className="mt-2 text-center text-[1.375rem] font-semibold leading-tight">Enter the claim code</h1>
          <p className="mt-2 text-center text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Eight letters and numbers on the card from your builder. One use, good for thirty days from the day it was printed.
          </p>
        </div>

        <form action={claimAction} className="space-y-4 border-t border-[var(--line)] px-5 py-5">
          <div>
            <label className="label block" htmlFor="claim-code">
              Claim code
            </label>
            <ClaimCodeInput defaultValue={code ?? ""} />
          </div>

          {me ? (
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              The house will be added to <span className="font-medium text-[var(--ink)]">{me.profile.name}</span>&apos;s record.
            </p>
          ) : (
            <>
              <p className="label pt-1">Your account</p>
              <div>
                <label className="label block" htmlFor="claim-name">
                  Your name
                </label>
                <input id="claim-name" name="name" required autoComplete="name" placeholder="Rupali Paradkar" className="input mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="claim-email">
                  Email
                </label>
                <input id="claim-email" name="email" type="email" required autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="you@example.com" className="input mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="claim-password">
                  Password
                </label>
                <input id="claim-password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input mt-1.5" />
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Ten characters or more.</p>
              </div>
            </>
          )}

          <ErrorLine message={sp.error} />
          <button type="submit" className="btn btn-primary w-full">
            {me ? "Add the house" : "Open my house"}
          </button>
        </form>

        {!me && (
          <p className="border-t border-[var(--line)] px-5 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
            Already have an account?{" "}
            <Link href="/?mode=signin" className="text-[var(--accent)]">
              Sign in first
            </Link>
            , then use the code — it will join the houses you already have.
          </p>
        )}
      </section>

      <p className="mt-6 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
        No code? Ask the contractor who built or is building the house. They print one from the record, and it can be reissued if it has expired.
      </p>
    </main>
  );
}
