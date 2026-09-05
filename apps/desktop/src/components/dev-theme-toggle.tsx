import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { api } from "@/trpc/react";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function DevThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const updateUIThemeMutation = api.settings.updateUITheme.useMutation();
  const appVersionQuery = api.settings.getAppVersion.useQuery(undefined, {
    staleTime: Infinity,
  });

  const effectiveTheme = resolvedTheme ?? theme;
  const isDark = effectiveTheme === "dark";

  const toggleTheme = () => {
    const nextTheme: "light" | "dark" = isDark ? "light" : "dark";
    setTheme(nextTheme);
    updateUIThemeMutation.mutate({ theme: nextTheme });
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={toggleTheme}
        className="cursor-pointer transition-colors"
      >
        {isDark ? (
          <Sun className="size-4 text-amber-400" />
        ) : (
          <Moon className="size-4 text-indigo-500" />
        )}
        <span>{isDark ? "Chế độ Sáng" : "Chế độ Tối"}</span>
      </SidebarMenuButton>
      <div className="px-2 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
        Phiên bản {appVersionQuery.data ?? "0.1.6"}
      </div>
    </SidebarMenuItem>
  );
}
