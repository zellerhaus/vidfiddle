"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Rss,
  FileText,
  Video,
  History,
  Settings,
  Plus,
  Inbox,
  Calendar,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "RSS Feeds", href: "/feeds", icon: Rss },
  { name: "Content", href: "/content", icon: FileText },
  { name: "YouTube Clips", href: "/youtube", icon: Youtube },
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
          <Video className="h-6 w-6 shrink-0 text-sidebar-primary" />
          {!collapsed && (
            <span className="text-lg font-semibold text-sidebar-accent-foreground whitespace-nowrap">
              VideoGen
            </span>
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
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground mb-4 shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">New Video</TooltipContent>
          </Tooltip>
        ) : (
          <Link href="/content/new">
            <Button className="w-full justify-start gap-2 mb-4">
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
                  "flex items-center transition-colors relative",
                  collapsed
                    ? "h-10 w-10 justify-center"
                    : "gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 whitespace-nowrap">{item.name}</span>
                    {showBadge && (
                      <Badge
                        variant="secondary"
                        className="h-5 min-w-[20px] px-1.5 text-xs"
                      >
                        {pendingCount}
                      </Badge>
                    )}
                  </>
                )}
                {collapsed && showBadge && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-sidebar-primary" />
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
          <div className="rounded-lg bg-sidebar-accent/50 p-3">
            <p className="text-xs text-sidebar-foreground">
              Personal Tool v0.1.0
            </p>
          </div>
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
