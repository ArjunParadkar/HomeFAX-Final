import type { WorkspaceKind } from "./workspace";

export type RailItem = { href: string; label: string; match?: string };
export type RailSection = { title: string; items: RailItem[] };

/** The rail's sections. The shared ones every institution gets; the middle block is the workspace's own. */
export function railSections(kind: WorkspaceKind): RailSection[] {
  const own: Record<WorkspaceKind, RailItem[]> = {
    municipality: [
      { href: "/jurisdiction", label: "Jurisdiction" },
      { href: "/inspections", label: "Inspections" },
      { href: "/permits", label: "Permits" },
    ],
    lender: [
      { href: "/portfolio", label: "Portfolio" },
      { href: "/draws", label: "Draws" },
    ],
    insurer: [{ href: "/policies", label: "Policies" }],
    brokerage: [{ href: "/listings", label: "Listings" }],
  };
  const ownTitle: Record<WorkspaceKind, string> = {
    municipality: "Inspections division",
    lender: "Lending",
    insurer: "Underwriting",
    brokerage: "Brokerage",
  };
  return [
    {
      title: "Workspace",
      items: [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/properties", label: "Properties" },
        { href: "/requests", label: "Requests" },
      ],
    },
    { title: ownTitle[kind], items: own[kind] },
    {
      title: "Institution",
      items: [
        { href: "/team", label: "Team" },
        { href: "/audit", label: "Audit" },
      ],
    },
  ];
}
