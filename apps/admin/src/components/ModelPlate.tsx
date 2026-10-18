import dynamicImport from "next/dynamic";

const ModelViewer = dynamicImport(() => import("@homefax/ui/model-viewer"));

/**
 * The instrument surface: the stage's model on onyx, with its provenance under
 * it. A procedural stand-in is always labelled as such — the viewer is never
 * presented as a reconstruction it is not.
 */
export default function ModelPlate({ url, stageLabel, simulated, filmed }: { url: string; stageLabel: string; simulated: boolean; filmed?: string }) {
  return (
    <figure className="plate overflow-hidden">
      <div className="h-[22rem] lg:h-[28rem]">
        <ModelViewer url={url} className="h-full w-full" />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-3">
        <span className="text-[0.8125rem] font-medium">{stageLabel}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {filmed && <span className="chip">filmed {filmed}</span>}
          <span className={`chip ${simulated ? "chip-accent" : ""}`}>{simulated ? "Simulated stand-in · not a reconstruction" : "Reconstructed from the capture"}</span>
        </span>
      </figcaption>
    </figure>
  );
}
