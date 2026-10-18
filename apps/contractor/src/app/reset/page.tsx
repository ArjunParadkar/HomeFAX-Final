import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorLine } from "@homefax/ui";
import { LogoMark } from "@homefax/ui";
import { Wordmark } from "@homefax/ui";
import { resetPasswordAction } from "@/app/account/actions";
import { currentUser, findPasswordReset } from "@/lib/accounts";
import { PASSWORD_MIN } from "@/lib/auth";

/**
 * The far end of a reset link. The token in the URL is checked before anything
 * is drawn — a dead link says so plainly and points back to sign-in, a live
 * one asks for the new password twice and signs the person straight in.
 */

export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (user) redirect("/records");

  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token) ?? "";
  const found = token ? await findPasswordReset(token) : null;

  return (
    <main className="shell flex flex-1 flex-col py-8">
      <section className="plate overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-6 pt-7">
          <LogoMark variant="logo" mode="still" surface="dark" size={96} />
          <h1 className="mt-1">
            <Wordmark size={25} tracking={0.34} accent="var(--claude)" />
          </h1>
          <p
            className="tnum mt-3.5 text-[0.625rem] font-medium uppercase"
            style={{ letterSpacing: "0.22em", color: "var(--ink-3)" }}
          >
            {found ? "Set a new password" : "Reset link"}
          </p>
        </div>

        <div className="border-t border-[var(--line)] px-5 py-5">
          {found ? (
            <form action={resetPasswordAction} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                This link is for <span className="font-medium text-[var(--ink)]">{found.user.name}</span>{" "}
                (@{found.user.handle}). Choose the new password below — it works once and signs you
                in.
              </p>
              <div>
                <label className="label block" htmlFor="reset-password">
                  New password
                </label>
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  required
                  minLength={PASSWORD_MIN}
                  autoComplete="new-password"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="reset-confirm">
                  New password again
                </label>
                <input
                  id="reset-confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={PASSWORD_MIN}
                  autoComplete="new-password"
                  className="input mt-1.5"
                />
              </div>
              <ErrorLine message={sp.error} />
              <button type="submit" className="btn btn-primary w-full">
                Set password and sign in
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <ErrorLine message={sp.error ?? "This reset link is not valid or has expired"} />
              <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                Reset links work once and expire after an hour. Ask your company&apos;s owner or
                admin for a new one from their Team page.
              </p>
              <Link href="/?mode=signin" className="btn btn-secondary w-full">
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
