"use client";

import * as React from "react";
import { AppLayout, Header } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
  Zap,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import type { CronLog, RssFeed } from "@/lib/supabase/types";

interface AutoModeStatus {
  lastCronRuns: {
    checkFeeds: CronLog | null;
    processQueue: CronLog | null;
    checkCreatify: CronLog | null;
  };
  queueCounts: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  recentErrors: Array<{
    cron_type: string;
    started_at: string;
    errors: string[];
    status: string;
  }>;
  feeds: Array<Pick<RssFeed, "id" | "title" | "url" | "auto_mode_enabled" | "auto_videos_per_post" | "last_checked_at">>;
}

export default function AutoModeStatusPage() {
  const [status, setStatus] = React.useState<AutoModeStatus | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isTriggering, setIsTriggering] = React.useState<string | null>(null);

  async function fetchStatus() {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/auto-mode/status");
      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setIsLoading(false);
    }
  }

  React.useEffect(() => {
    fetchStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  async function triggerCron(cronType: string) {
    setIsTriggering(cronType);
    try {
      const endpoint = `/api/cron/${cronType}`;
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "x-cron-secret": "manual-trigger", // This will fail unless CRON_SECRET is set to this
        },
      });

      if (response.status === 401) {
        toast.error("Manual trigger not authorized. Set CRON_SECRET to 'manual-trigger' for testing.");
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to trigger cron");
      }

      const data = await response.json();
      toast.success(`Triggered ${cronType}: ${JSON.stringify(data)}`);
      // Refresh status after trigger
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger cron");
    } finally {
      setIsTriggering(null);
    }
  }

  function formatRelativeTime(dateString: string | null): string {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }

  if (isLoading && !status) {
    return (
      <AppLayout>
        <Header title="Auto Mode Status" description="Monitor automatic video generation" />
        <div className="flex-1 overflow-auto p-12 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <Header title="Auto Mode Status" description="Monitor automatic video generation" />
        <div className="flex-1 overflow-auto p-12">
          <Card>
            <CardContent className="flex items-center gap-2 p-6 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={fetchStatus} className="ml-auto">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Header
        title="Auto Mode Status"
        description="Monitor automatic video generation pipeline"
        actions={
          <Button variant="outline" onClick={fetchStatus} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <div className="flex-1 overflow-auto p-12 space-y-6">
        {/* Cron Status Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Check Feeds */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Check Feeds</CardTitle>
                {status?.lastCronRuns.checkFeeds?.status === "success" ? (
                  <CheckCircle className="h-4 w-4 fill-pastel-green" />
                ) : status?.lastCronRuns.checkFeeds?.status === "error" ? (
                  <AlertCircle className="h-4 w-4 fill-destructive" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <CardDescription>Hourly feed check</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {formatRelativeTime(status?.lastCronRuns.checkFeeds?.started_at ?? null)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => triggerCron("check-feeds")}
                disabled={isTriggering === "check-feeds"}
              >
                {isTriggering === "check-feeds" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Test Run
              </Button>
            </CardContent>
          </Card>

          {/* Process Queue */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Process Queue</CardTitle>
                {status?.lastCronRuns.processQueue?.status === "success" ? (
                  <CheckCircle className="h-4 w-4 fill-pastel-green" />
                ) : status?.lastCronRuns.processQueue?.status === "error" ? (
                  <AlertCircle className="h-4 w-4 fill-destructive" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <CardDescription>Every 5 minutes</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {formatRelativeTime(status?.lastCronRuns.processQueue?.started_at ?? null)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => triggerCron("process-queue")}
                disabled={isTriggering === "process-queue"}
              >
                {isTriggering === "process-queue" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Test Run
              </Button>
            </CardContent>
          </Card>

          {/* Check Creatify */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Check Creatify</CardTitle>
                {status?.lastCronRuns.checkCreatify?.status === "success" ? (
                  <CheckCircle className="h-4 w-4 fill-pastel-green" />
                ) : status?.lastCronRuns.checkCreatify?.status === "error" ? (
                  <AlertCircle className="h-4 w-4 fill-destructive" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <CardDescription>Every 2 minutes</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {formatRelativeTime(status?.lastCronRuns.checkCreatify?.started_at ?? null)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => triggerCron("check-creatify")}
                disabled={isTriggering === "check-creatify"}
              >
                {isTriggering === "check-creatify" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Test Run
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Queue Status */}
        <Card>
          <CardHeader>
            <CardTitle>Generation Queue</CardTitle>
            <CardDescription>Current queue status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="flex flex-col">
                <span className="text-2xl font-bold">{status?.queueCounts.pending ?? 0}</span>
                <span className="text-sm text-muted-foreground">Pending</span>
              </div>
              <div className="flex flex-col">
                <span className="display text-4xl">{status?.queueCounts.processing ?? 0}</span>
                <span className="text-sm text-muted-foreground">Processing</span>
              </div>
              <div className="flex flex-col">
                <span className="display text-4xl">{status?.queueCounts.completed ?? 0}</span>
                <span className="text-sm text-muted-foreground">Completed</span>
              </div>
              <div className="flex flex-col">
                <span className="display text-4xl">{status?.queueCounts.failed ?? 0}</span>
                <span className="text-sm text-muted-foreground">Failed</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Feeds with Auto Mode */}
          <Card>
            <CardHeader>
              <CardTitle>Auto Mode Feeds</CardTitle>
              <CardDescription>Feeds configured for automatic generation</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[250px] [&_[data-radix-scroll-area-viewport]>div]:!block">
                <div className="divide-y">
                  {status?.feeds.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No feeds configured
                    </div>
                  ) : (
                    status?.feeds.map((feed) => (
                      <div key={feed.id} className="flex items-center justify-between p-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{feed.title || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground truncate">{feed.url}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 ml-2">
                          {feed.auto_mode_enabled ? (
                            <Badge className="bg-pastel-yellow">
                              <Zap className="h-3 w-3 mr-1" />
                              {feed.auto_videos_per_post}x
                            </Badge>
                          ) : (
                            <Badge variant="outline">Manual</Badge>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Recent Errors */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Errors</CardTitle>
              <CardDescription>Cron job failures</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[250px] [&_[data-radix-scroll-area-viewport]>div]:!block">
                <div className="divide-y">
                  {status?.recentErrors.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No recent errors
                    </div>
                  ) : (
                    status?.recentErrors.map((error, index) => (
                      <div key={index} className="p-4">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="destructive" className="text-xs">
                            {error.cron_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(error.started_at)}
                          </span>
                        </div>
                        {Array.isArray(error.errors) && error.errors.length > 0 && (
                          <ul className="text-xs text-muted-foreground mt-1">
                            {error.errors.slice(0, 3).map((err, i) => (
                              <li key={i} className="truncate">• {err}</li>
                            ))}
                            {error.errors.length > 3 && (
                              <li className="text-muted-foreground/70">
                                +{error.errors.length - 3} more
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
