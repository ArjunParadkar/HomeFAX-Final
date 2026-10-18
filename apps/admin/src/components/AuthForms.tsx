import Link from "next/link";
import { ErrorLine } from "@homefax/ui";
import { signInAction, signUpAction } from "@/app/account/actions";

/**
 * Sign in and create account as two links, not two client states. The forms
 * post to the account actions; `next` is where to land afterwards (the join
 * page uses it so an invited person comes straight back to the invitation).
 */
export default function AuthForms({ mode, error, next, basePath = "/" }: { mode: "signin" | "signup"; error?: string | string[]; next?: string; basePath?: string }) {
  const sep = basePath.includes("?") ? "&" : "?";
  return (
    <section className="plate overflow-hidden">
      <div className="flex border-b border-[var(--line)]">
        <Tab href={`${basePath}${sep}mode=signin`} label="Sign in" active={mode === "signin"} />
        <Tab href={`${basePath}${sep}mode=signup`} label="Create account" active={mode === "signup"} />
      </div>
      <div className="px-5 py-5">
        {mode === "signin" ? (
          <form action={signInAction} className="space-y-4">
            {next && <input type="hidden" name="next" value={next} />}
            <div>
              <label className="label block" htmlFor="signin-email">
                Email
              </label>
              <input id="signin-email" name="email" type="email" required autoComplete="email" autoCapitalize="off" spellCheck={false} placeholder="you@city.gov" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="signin-password">
                Password
              </label>
              <input id="signin-password" name="password" type="password" required autoComplete="current-password" className="input mt-1.5" />
            </div>
            <ErrorLine message={error} />
            <button type="submit" className="btn btn-primary w-full">
              Sign in
            </button>
          </form>
        ) : (
          <form action={signUpAction} className="space-y-4">
            {next && <input type="hidden" name="next" value={next} />}
            <div>
              <label className="label block" htmlFor="signup-name">
                Your name
              </label>
              <input id="signup-name" name="name" required autoComplete="name" placeholder="Cal Nguyen" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="signup-email">
                Work email
              </label>
              <input id="signup-email" name="email" type="email" required autoComplete="email" autoCapitalize="off" spellCheck={false} placeholder="you@city.gov" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="signup-password">
                Password
              </label>
              <input id="signup-password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input mt-1.5" />
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Ten characters or more.</p>
            </div>
            <div>
              <label className="label block" htmlFor="signup-headline">
                Your role <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input id="signup-headline" name="headline" placeholder="Building inspector" className="input mt-1.5" />
            </div>
            <ErrorLine message={error} />
            <button type="submit" className="btn btn-primary w-full">
              Create account
            </button>
          </form>
        )}
      </div>
      <p className="border-t border-[var(--line)] px-5 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
        One account per person. Register your institution once you are in, or accept the invitation link a colleague sent you.
      </p>
    </section>
  );
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="label flex min-h-[2.75rem] flex-1 items-center justify-center border-b-2 px-2 text-center text-[0.6875rem]"
      style={{ borderColor: active ? "var(--accent)" : "transparent", color: active ? "var(--accent)" : "var(--ink-3)", marginBottom: "-1px" }}
    >
      {label}
    </Link>
  );
}
