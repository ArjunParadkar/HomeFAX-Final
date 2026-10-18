import { AppHeader as Header, type NavTabDef } from "@homefax/ui";
import type { ComponentProps } from "react";

/** The homeowner app's two sections, in the shared header. */
const TABS = [
  { id: "home", href: "/home", label: "Your homes" },
  { id: "account", href: "/account", label: "Account" },
] as const satisfies readonly NavTabDef[];

export type NavTab = (typeof TABS)[number]["id"];

type Props = Omit<ComponentProps<typeof Header>, "tabs" | "nav" | "homeHref" | "homeLabel"> & {
  nav?: NavTab;
};

export default function AppHeader(props: Props) {
  return <Header {...props} tabs={[...TABS]} homeHref="/home" homeLabel="HomeFAX — your homes" />;
}
