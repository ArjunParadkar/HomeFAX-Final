import Link from "next/link";
import { LogoMark } from "@homefax/ui";

/**
 * Nothing here — or nothing here for you. Row-level security hides a house
 * the reader cannot see, so "not yours" and "does not exist" look the same on
 * purpose: the record never confirms an address to a stranger.
 */
export default function NotFound() {
  return (
    <main className="shell flex flex-1 flex-col items-center justify-center py-16">
      <section className="plate w-full overflow-hidden">
        <div className="flex flex-col items-center px-5 pb-6 pt-7">
          <LogoMark variant="logo" mode="still" surface="dark" size={96} />
          <p className="eyebrow mt-3">Not on your record</p>
          <h1 className="mt-2 text-center text-[1.25rem] font-semibold leading-tight">There is nothing here for you</h1>
          <p className="mt-2 text-center text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Either this page does not exist, or it belongs to a house you do not own. A house joins your record with a claim code from its builder.
          </p>
          <div className="mt-5 flex w-full gap-2">
            <Link href="/home" className="btn btn-secondary flex-1">
              Your homes
            </Link>
            <Link href="/claim" className="btn btn-primary flex-1">
              Claim a house
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
