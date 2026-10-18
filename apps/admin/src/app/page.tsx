import { redirect } from "next/navigation";
import { LogoMark, Wordmark } from "@homefax/ui";
import { STAGES } from "@homefax/core";
import AuthForms from "@/components/AuthForms";
import { kit } from "@/lib/kit";
import { currentWorkspace } from "@/lib/workspace";

/**
 * The front of the ledger room. The mark on onyx, the record's terms, and the
 * way in. Signed-in people go straight to their dashboard — or to onboarding
 * when they have not registered an institution yet.
 */

export const dynamic = "force-dynamic";

const WORKSPACES = [
  { kind: "Municipality", body: "Every filmed stage inside your jurisdiction, queued for review. Verify, flag, or schedule a site visit against the model." },
  { kind: "Lender", body: "Construction draws decided against the graded record of the stage they fund, with the reasons written down." },
  { kind: "Insurer", body: "Underwrite from the 50-point ledger — structure, envelope, moisture, safety — not from a drive-by." },
  { kind: "Brokerage", body: "List with the house's own record behind it and hand buyers a report they can check." },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const me = await kit.currentPrincipal();
  if (me) redirect((await currentWorkspace()) ? "/dashboard" : "/onboard");

  const sp = await searchParams;
  const raw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const mode = raw === "signup" ? "signup" : "signin";

  return (
    <main className="mx-auto w-full max-w-[64rem] flex-1 px-5 py-8 lg:px-8 lg:py-12">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          <section className="plate overflow-hidden">
            <div className="flex flex-col items-center px-5 pb-6 pt-7">
              <LogoMark variant="logo" mode="once" surface="dark" size={128} />
              <h1 className="mt-1">
                <Wordmark size={25} tracking={0.34} accent="var(--claude)" />
              </h1>
              <p className="tnum mt-3.5 text-[0.625rem] font-medium uppercase" style={{ letterSpacing: "0.22em", color: "var(--ink-3)" }}>
                For the institutions that hold the house
              </p>
            </div>
            <dl className="rule-grid grid-cols-4">
              <div className="field">
                <dt>Stages</dt>
                <dd>{STAGES.length}</dd>
              </div>
              <div className="field">
                <dt>Ledger</dt>
                <dd>50 pts</dd>
              </div>
              <div className="field">
                <dt>Workspaces</dt>
                <dd>4</dd>
              </div>
              <div className="field">
                <dt>Kept</dt>
                <dd>For life</dd>
              </div>
            </dl>
          </section>

          <p className="text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">
            The record of how a house was built, read at the desk that has to decide about it. Municipalities review what was filmed, lenders fund what was graded, insurers price what the ledger shows, brokerages list what the record proves. Every look is logged — institutions are accountable too.
          </p>

          <section>
            <h2 className="eyebrow">Four workspaces, one record</h2>
            <ul className="card mt-2.5 overflow-hidden">
              {WORKSPACES.map((w) => (
                <li key={w.kind} className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
                  <p className="label">{w.kind}</p>
                  <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--ink-2)]">{w.body}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="lg:sticky lg:top-8">
          <AuthForms mode={mode} error={sp.error} />
          <p className="eyebrow mt-6 text-center">Institution edition · every look is on the record</p>
        </div>
      </div>
    </main>
  );
}
