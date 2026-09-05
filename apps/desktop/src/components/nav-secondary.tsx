import * as React from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { DevThemeToggle } from "@/components/dev-theme-toggle";
import type { NavSecondaryItem } from "@/components/nav-secondary-item-button";
export type { NavSecondaryItem } from "@/components/nav-secondary-item-button";

export function NavSecondary({
  items: _items,
  ...props
}: {
  items?: NavSecondaryItem[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <DevThemeToggle />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
