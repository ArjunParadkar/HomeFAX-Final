import Link from "next/link";
import { ErrorLine, Wordmark } from "@homefax/ui";
import { registerInstitutionAction } from "@/app/onboard/actions";
import { signOutAction } from "@/app/account/actions";
import { kit } from "@/lib/kit";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const KINDS = [
  { value: "municipality", label: "Municipality", line: "Review filmed stages in your jurisdiction, issue permits, record verdicts." },
  { value: "lender", label: "Lender", line: "Hold loans against houses and decide construction draws on the graded record." },
  { value: "insurer", label: "Insurer", line: "Underwrite policies from the 50-point ledger and the open findings." },
  { value: "brokerage", label: "Brokerage", line: "List houses with their record behind them and issue buyer reports." },
] as const;

/** "Register your institution." The first thing a new person does; also where a member of one institution registers another. */
export default async function OnboardPage({ searchParams }: PageProps<"/onboard">) {
  const me = await kit.requirePrincipal();
  const ws = await currentWorkspace();
  const sp = await searchParams;

  return (
    <main className="mx-auto w-full max-w-[44rem] flex-1 px-5 py-8 lg:py-12">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href={ws ? "/dashboard" : "/"} aria-label="HomeFAX" className="flex min-h-[2.25rem] items-center">
          <Wordmark size={17} tracking={0.16} />
        </Link>
        <div className="flex items-center gap-3 text-[0.75rem] text-[var(--ink-3)]">
          <span className="truncate">{me.identity.email}</span>
          {ws ? (
            <Link href="/dashboard" className="btn btn-secondary btn-sm">
              Back to {ws.org.name}
            </Link>
          ) : (
            <form action={signOutAction}>
              <button type="submit" className="btn btn-secondary btn-sm">
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>

      <header className="mb-5">
        <p className="eyebrow">Register your institution</p>
        <h1 className="mt-1.5 text-[1.5rem] font-semibold leading-tight">Who are you acting for?</h1>
        <p className="mt-1.5 max-w-[60ch] text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          One registration per institution. You become its owner and can invite colleagues from the Team page. The kind decides which workspace opens.
        </p>
      </header>

      <form action={registerInstitutionAction} className="card space-y-5 px-5 py-5">
        <div>
          <label className="label block" htmlFor="name">
            Institution name
          </label>
          <input id="name" name="name" required minLength={2} placeholder="City of Bentonville" className="input mt-1.5" />
        </div>

        <fieldset>
          <legend className="label">Kind</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <label key={k.value} className="flex cursor-pointer gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 has-[:checked]:border-[var(--accent)]">
                <input type="radio" name="kind" value={k.value} required className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className="block text-[0.9375rem] font-semibold leading-snug">{k.label}</span>
                  <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{k.line}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label block" htmlFor="headline">
            Headline <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input id="headline" name="headline" placeholder="Building Inspections Division" className="input mt-1.5" />
        </div>

        <fieldset className="sheet px-4 py-4">
          <legend className="label px-1">First jurisdiction · municipalities only</legend>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
            Your statutory view. Every house whose address falls inside it opens at ledger scope. Give the state and at least one of city, county, or ZIP; add more on the Team page later.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div>
              <label className="label block" htmlFor="state">
                State
              </label>
              <input id="state" name="state" maxLength={2} placeholder="AR" autoCapitalize="characters" className="input input-sm tnum mt-1.5 uppercase" />
            </div>
            <div>
              <label className="label block" htmlFor="city">
                City
              </label>
              <input id="city" name="city" placeholder="Bentonville" className="input input-sm mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="county">
                County
              </label>
              <input id="county" name="county" placeholder="Benton" className="input input-sm mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="postalCode">
                ZIP
              </label>
              <input id="postalCode" name="postalCode" placeholder="72712" inputMode="numeric" className="input input-sm tnum mt-1.5" />
            </div>
          </div>
        </fieldset>

        <ErrorLine message={sp.error} />
        <button type="submit" className="btn btn-primary w-full sm:w-auto">
          Register the institution
        </button>
      </form>
    </main>
  );
}
