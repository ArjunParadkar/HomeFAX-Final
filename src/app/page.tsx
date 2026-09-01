import { redirect } from "next/navigation";
import KeyGate from "@/components/KeyGate";
import LogoMark from "@/components/brand/LogoMark";
import Wordmark from "@/components/brand/Wordmark";
import { authConfigured, currentKey } from "@/lib/auth";
import { STAGES } from "@/lib/stages";

/**
 * The gate. Onyx placard on top — the instrument — then the record's own terms
 * set on paper, then the key. Nothing here sells; it states what the record is
 * and what it costs the reader to make one.
 */

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

export default async function Home() {
  const key = await currentKey();
  if (key) redirect("/records");

  return (
    <main className="shell flex flex-1 flex-col py-8">
      <section className="plate overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-6 pt-7">
          <LogoMark mode="loop" surface="dark" size={168} />
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

      <section className="plate mt-7 overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3">
          <h2 className="eyebrow">Contractor access</h2>
        </div>
        <div className="px-5 py-5">
          {authConfigured() ? (
            <KeyGate />
          ) : (
            <div className="space-y-2">
              <h3 className="text-[0.9375rem] font-semibold">No keys are set on this deployment</h3>
              <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                Set <code className="tnum text-[var(--accent)]">ACCESS_KEYS</code> to a
                comma-separated list of{" "}
                <code className="tnum text-[var(--accent)]">secret:Label</code> pairs, then reload
                this page.
              </p>
            </div>
          )}
        </div>
      </section>

      <p className="eyebrow mt-6 text-center">Contractor edition · access by key only</p>
    </main>
  );
}
