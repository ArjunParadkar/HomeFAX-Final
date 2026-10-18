import Rail from "@/components/Rail";
import { requireWorkspace } from "@/lib/workspace";

/** The ledger room: rail on the left, the page on the right. Every page in here has a signed-in person with an institution. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  return (
    <div className="workspace">
      <Rail ws={ws} />
      <main className="workspace-main">{children}</main>
    </div>
  );
}
