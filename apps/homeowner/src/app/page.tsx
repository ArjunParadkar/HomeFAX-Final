import Link from "next/link";
import { redirect } from "next/navigation";
import { STAGES } from "@homefax/core";
import { ErrorLine, LogoMark, Wordmark } from "@homefax/ui";
import { signInAction, signUpAction } from "@/app/account/actions";
import HouseCard from "@/components/HouseCard";
import type { Tick } from "@/lib/house";
import { kit } from "@/lib/kit";

/**
 * The front door. The house draws itself in on the onyx plate, then the house
 * card — empty, every tick hollow — shows what a record looks like before a
 * single stage is on it. Then the two ways in, and the third: a claim code.
 *
 * Sign in and create account are two links, not two client states: the page
 * stays a server component and the browser back button walks the tabs.
 */

export const dynamic = "force-dynamic";

const EMPTY_TICKS: Tick[] = STAGES.map((s) => ({ stage: s.id, label: s.label, short: s.short, state: "open", grade: null, score: null }));

const WHAT_YOU_GET = [
  { where: "Every stage", body: "Your builder films each of the eleven stages while the walls are still open. Each walk becomes a measured 3D model you can turn in your hand." },
  { where: "Every point", body: "Fifty named checkpoints — plumb, flashing, fire-blocking, box fill — each passed or failed with the frame that shows it." },
  { where: "Every year", body: "The record stays with the house, not the builder. You decide who sees it: your lender, your insurer, the next owner." },
];

export default async function Landing({ searchParams }: PageProps<"/">) {
  const me = await kit.currentPrincipal();
  if (me) redirect("/home");

  const sp = await searchParams;
  const raw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const mode = raw === "signup" ? "signup" : "signin";
  const erased = sp.erased === "1";

  return (
    <main className="shell flex flex-1 flex-col py-8">
      <section className="plate overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-5 pt-7">
          <LogoMark variant="house" mode="once" surface="dark" size={150} />
          <h1 className="mt-1">
            <Wordmark size={25} tracking={0.34} accent="var(--claude)" />
          </h1>
          <p className="tnum mt-3.5 text-[0.625rem] font-medium uppercase" style={{ letterSpacing: "0.22em", color: "var(--ink-3)" }}>
            Your house. Its whole story.
          </p>
        </div>
        <div className="border-t border-[var(--line)]">
          <HouseCard
            surface="plate"
            eyebrow="Your address here"
            address="The record of how it was built"
            standing={`${STAGES.length} stages · 50-point ledger · kept for the life of the house`}
            ticks={EMPTY_TICKS}
          />
        </div>
      </section>

      <section className="plate mt-7 overflow-hidden">
        <div className="flex border-b border-[var(--line)]">
          <Tab href="/?mode=signin" label="Sign in" active={mode === "signin"} />
          <Tab href="/?mode=signup" label="Create account" active={mode === "signup"} />
        </div>

        <div className="px-5 py-5">
          {erased && (
            <p className="mb-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Your account has been erased. The houses you owned keep their record; your name is gone from it.
            </p>
          )}
          {mode === "signin" ? (
            <form action={signInAction} className="space-y-4">
              <div>
                <label className="label block" htmlFor="signin-email">
                  Email
                </label>
                <input id="signin-email" name="email" type="email" required autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="you@example.com" className="input mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="signin-password">
                  Password
                </label>
                <input id="signin-password" name="password" type="password" required autoComplete="current-password" className="input mt-1.5" />
              </div>
              <ErrorLine message={sp.error} />
              <button type="submit" className="btn btn-primary w-full">
                Sign in
              </button>
            </form>
          ) : (
            <form action={signUpAction} className="space-y-4">
              <div>
                <label className="label block" htmlFor="signup-name">
                  Your name
                </label>
                <input id="signup-name" name="name" required autoComplete="name" placeholder="Rupali Paradkar" className="input mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="signup-email">
                  Email
                </label>
                <input id="signup-email" name="email" type="email" required autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="you@example.com" className="input mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="signup-password">
                  Password
                </label>
                <input id="signup-password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input mt-1.5" />
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Ten characters or more.</p>
              </div>
              <ErrorLine message={sp.error} />
              <button type="submit" className="btn btn-primary w-full">
                Create account
              </button>
              <p className="text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                An account with no house yet. If your builder gave you a claim code, use it below instead — it makes the account and opens the house in one step.
              </p>
            </form>
          )}
        </div>
      </section>

      <Link href="/claim" className="card mt-4 flex min-h-[3.5rem] items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-semibold leading-snug">Have a claim code?</span>
          <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
            Eight characters on the card your builder handed you. It opens your house.
          </span>
        </span>
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
          <path d="m6 3.5 4.5 4.5L6 12.5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>

      <p className="mt-7 text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">
        The permanent record of how your house was actually built — filmed stage by stage while the walls were open, measured, graded against 50 named points, and handed to you with the keys.
      </p>

      <section className="mt-6">
        <h2 className="eyebrow">What you get</h2>
        <ul className="card mt-2.5 overflow-hidden">
          {WHAT_YOU_GET.map((s) => (
            <li key={s.where} className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
              <p className="label">{s.where}</p>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--ink-2)]">{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="eyebrow mt-7 text-center">Homeowner edition · kept for the life of the house</p>
    </main>
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
