import Link from "next/link";
import { redirect } from "next/navigation";
import ErrorLine from "@/components/ErrorLine";
import LogoMark from "@/components/brand/LogoMark";
import Wordmark from "@/components/brand/Wordmark";
import { signInAction, signUpAction } from "@/app/account/actions";
import { currentUser } from "@/lib/accounts";
import { STAGES } from "@/lib/stages";

/**
 * The front of the record. The mark sits on the onyx placard as the finished
 * house — the drawing is done, which is the whole promise — then the record's
 * own terms on paper, then the way in.
 *
 * Sign in and create account are two links, not two client states: the page
 * stays a server component and the browser back button walks the tabs.
 */

export const dynamic = "force-dynamic";

const WHERE_THE_WORK_HAPPENS = [
  {
    where: "On site",
    body: "One slow lap of the stage on your phone. Frames are scored for sharpness and thinned on the device — the video never leaves it.",
  },
  {
    where: "On the GPU",
    body: "Photogrammetry turns the walk into a dimensioned model. Plumb, level, flatness, and stud spacing are measured off it rather than eyeballed.",
  },
  {
    where: "On the record",
    body: "Each stage keeps its model, its ledger of checked points, and its parts list. Whoever owns the house next inherits all of it.",
  },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await currentUser();
  if (user) redirect("/records");

  const sp = await searchParams;
  const raw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const mode = raw === "signup" ? "signup" : "signin";

  return (
    <main className="shell flex flex-1 flex-col py-8">
      <section className="plate overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-6 pt-7">
          <LogoMark mode="still" surface="dark" size={140} />
          <h1 className="mt-1">
            <Wordmark size={25} tracking={0.34} accent="var(--claude)" />
          </h1>
          <p
            className="tnum mt-3.5 text-[0.625rem] font-medium uppercase"
            style={{ letterSpacing: "0.22em", color: "var(--ink-3)" }}
          >
            Every home. Its whole story.
          </p>
        </div>

        <dl className="rule-grid grid-cols-3">
          <div className="field">
            <dt>Stages</dt>
            <dd>{STAGES.length}</dd>
          </div>
          <div className="field">
            <dt>Ledger</dt>
            <dd>50 pts</dd>
          </div>
          <div className="field">
            <dt>Kept</dt>
            <dd>For life</dd>
          </div>
        </dl>
      </section>

      <section className="plate mt-7 overflow-hidden">
        <div className="flex border-b border-[var(--line)]">
          <Tab href="/?mode=signin" label="Sign in" active={mode === "signin"} />
          <Tab href="/?mode=signup" label="Create account" active={mode === "signup"} />
        </div>

        <div className="px-5 py-5">
          {mode === "signin" ? (
            <form action={signInAction} className="space-y-4">
              <div>
                <label className="label block" htmlFor="signin-email">
                  Email
                </label>
                <input
                  id="signin-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@crew.build"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="signin-password">
                  Password
                </label>
                <input
                  id="signin-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="input mt-1.5"
                />
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
                <input
                  id="signup-name"
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Dana Reyes"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="signup-email">
                  Email
                </label>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@crew.build"
                  className="input mt-1.5"
                />
              </div>
              <div>
                <label className="label block" htmlFor="signup-password">
                  Password
                </label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="input mt-1.5"
                />
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                  Eight characters or more.
                </p>
              </div>
              <div>
                <label className="label block" htmlFor="signup-handle">
                  Handle <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="signup-handle"
                  name="handle"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="dreyes"
                  className="input tnum mt-1.5"
                />
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                  How crews find you on the hire board. Taken from your name if you leave it blank.
                </p>
              </div>
              <div>
                <label className="label block" htmlFor="signup-headline">
                  Your trade <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="signup-headline"
                  name="headline"
                  placeholder="Framing lead, 12 years"
                  className="input mt-1.5"
                />
              </div>
              <ErrorLine message={sp.error} />
              <button type="submit" className="btn btn-primary w-full">
                Create account
              </button>
            </form>
          )}
        </div>

        <p className="border-t border-[var(--line)] px-5 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
          One account per person. Records are filed to a company — register yours once you are in,
          or hand your HomeFAX key to the builder who is already on the job.
        </p>
      </section>

      <p className="mt-7 text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">
        The permanent record of how a house was actually built — filmed stage by stage while the
        walls are still open, measured, graded against 50 named points, and handed on with the keys.
      </p>

      <section className="mt-6">
        <h2 className="eyebrow">Where the work happens</h2>
        <ul className="card mt-2.5 overflow-hidden">
          {WHERE_THE_WORK_HAPPENS.map((s) => (
            <li key={s.where} className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
              <p className="label">{s.where}</p>
              <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--ink-2)]">{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="eyebrow">The sequence, every time</h2>
        <p className="mt-2.5 text-[0.75rem] uppercase leading-[1.9] tracking-[0.1em] text-[var(--ink-3)]">
          {STAGES.map((s, i) => (
            <span key={s.id}>
              {i > 0 && <span className="text-[var(--line)]"> / </span>}
              <span className="tnum">{s.short}</span>
            </span>
          ))}
        </p>
      </section>

      <p className="eyebrow mt-7 text-center">Contractor edition · kept for the life of the house</p>
    </main>
  );
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="label flex min-h-[2.75rem] flex-1 items-center justify-center border-b-2 px-2 text-center text-[0.6875rem]"
      style={{
        borderColor: active ? "var(--accent)" : "transparent",
        color: active ? "var(--accent)" : "var(--ink-3)",
        marginBottom: "-1px",
      }}
    >
      {label}
    </Link>
  );
}
