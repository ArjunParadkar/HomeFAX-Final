import { AppHeader as Header, type NavTabDef } from "@homefax/ui";
import type { ComponentProps } from "react";

/** The contractor app's four sections, in the shared header. */
const TABS = [
  { id: "records", href: "/records", label: "On file" },
  { id: "hire", href: "/hire", label: "Hire" },
  { id: "team", href: "/team", label: "Team" },
  { id: "profile", href: "/profile", label: "Profile" },
] as const satisfies readonly NavTabDef[];

export type NavTab = (typeof TABS)[number]["id"];

type Props = Omit<ComponentProps<typeof Header>, "tabs" | "nav" | "homeHref" | "homeLabel"> & {
  nav?: NavTab;
};

export default function AppHeader(props: Props) {
  return <Header {...props} tabs={[...TABS]} homeHref="/records" homeLabel="HomeFAX records" />;
}
