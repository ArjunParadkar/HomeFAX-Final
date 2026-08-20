import { redirect } from "next/navigation";
import KeyGate from "@/components/KeyGate";
import { authConfigured, currentKey } from "@/lib/auth";

const STEPS = [
  {
    n: "01",
    title: "Film the stage",
    body: "One slow lap of each room on your phone. The frames are picked and thinned before anything uploads.",
  },
  {
    n: "02",
    title: "Get a measured model",
    body: "Photogrammetry on a GPU turns the walk into a dimensioned 3D model — plumb, level, and spacing all measured off it.",
  },
  {
    n: "03",
    title: "Keep it forever",
    body: "Every stage's model is stored with the record — the house's history in 3D, from the first pour to the final walkthrough.",
  },
];

export default async function Home() {
  const key = await currentKey();
  if (key) redirect("/records");

  return (
    <main className="shell flex flex-1 flex-col justify-center py-14">
      <header>
        <p className="label">Built record · since the first pour</p>
        <h1 className="mt-3 text-[2.75rem] font-bold leading-[0.95] tracking-tight">
          HOME
          <span className="text-[var(--accent)]">FAX</span>
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">
          The permanent record of how a house was actually built — filmed stage by
          stage and turned into a 3D model while the walls are still open.
        </p>
      </header>

      <ol className="mt-9 space-y-5">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-4">
            <span className="tnum pt-0.5 text-sm font-semibold text-[var(--accent)]">{s.n}</span>
            <div>
              <h2 className="text-[0.9375rem] font-semibold">{s.title}</h2>
              <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="card mt-10 p-5">
        {authConfigured() ? (
          <KeyGate />
        ) : (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">This deployment has no keys yet</h2>
            <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Set <code className="tnum">ACCESS_KEYS</code> to a comma-separated list of{" "}
              <code className="tnum">secret:Label</code> pairs, then reload.
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-[var(--ink-3)]">
        Contractor edition · access by key only
      </p>
    </main>
  );
}
