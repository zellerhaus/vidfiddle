"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Rss,
  FileText,
  History,
  Settings,
  Plus,
  Inbox,
  Calendar,
  LogOut,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VidfiddleMark, VidfiddleWordmark } from "@/components/brand";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "RSS Feeds", href: "/feeds", icon: Rss },
  { name: "Content", href: "/content", icon: FileText },
  { name: "Queue", href: "/queue", icon: Inbox, showBadge: true },
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "History", href: "/history", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
];

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  return stored !== null ? stored === "true" : true;
}

export function Sidebar() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  useEffect(() => {
    async function fetchPendingCount() {
      try {
        const response = await fetch("/api/queue/count");
        if (response.ok) {
          const data = await response.json();
          setPendingCount(data.count);
        }
      } catch (error) {
        console.error("Failed to fetch pending count:", error);
      }
    }

    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 30000);
    return () => clearInterval(interval);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar transition-all duration-200 overflow-hidden",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border",
          collapsed ? "justify-center" : "px-6"
        )}
      >
        <Link href="/" className="flex items-center gap-2">
          <VidfiddleMark />
          {!collapsed && (
            <VidfiddleWordmark className="text-[22px] text-white whitespace-nowrap" />
          )}
        </Link>
      </div>

      {/* Navigation */}
      <div
        className={cn(
          "flex flex-1 flex-col gap-1",
          collapsed ? "items-center p-2" : "p-4"
        )}
      >
        {/* New Video Button */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/content/new"
                className="flex h-10 w-10 items-center justify-center border-2 border-white bg-sidebar-primary text-sidebar-primary-foreground shadow-[3px_3px_0_0_#fff] mb-4 shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">New Video</TooltipContent>
          </Tooltip>
        ) : (
          <Link href="/content/new">
            <Button className="w-full justify-start gap-2 mb-4 border-white shadow-[4px_4px_0_0_#fff] hover:shadow-[5px_5px_0_0_#fff]">
              <Plus className="h-4 w-4" />
              New Video
            </Button>
          </Link>
        )}

        {/* Nav Items */}
        <nav className="flex flex-col gap-1 w-full">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            const showBadge = item.showBadge && pendingCount > 0;

            const navContent = (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center border-2 transition-colors relative",
                  collapsed
                    ? "h-10 w-10 justify-center"
                    : "gap-3 px-3 py-2 label-chrome text-xs",
                  isActive
                    ? "border-white bg-sidebar-primary text-sidebar-primary-foreground"
                    : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 whitespace-nowrap">{item.name}</span>
                    {showBadge && (
                      <Badge
                        variant="pink"
                        className="h-5 min-w-[20px] px-1.5 text-xs"
                      >
                        {pendingCount}
                      </Badge>
                    )}
                  </>
                )}
                {collapsed && showBadge && (
                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-black bg-pastel-pink" />
                )}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>{navContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.name}</TooltipContent>
                </Tooltip>
              );
            }

            return navContent;
          })}
        </nav>
      </div>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-sidebar-border",
          collapsed ? "p-2 flex flex-col items-center gap-2" : "p-4 space-y-2"
        )}
      >
        {!collapsed && (
          <Link
            href="/settings/about"
            className="block border-2 border-sidebar-border p-3 label-chrome text-[11px] text-sidebar-foreground hover:border-white hover:text-white"
          >
            Vidfiddle · MIT · Credits
          </Link>
        )}

        {collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex h-10 w-10 items-center justify-center text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    window.location.href = "/login";
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapsed}
                  className="flex h-10 w-10 items-center justify-center text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
              onClick={toggleCollapsed}
            >
              <ChevronLeft className="h-4 w-4" />
              Collapse
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
