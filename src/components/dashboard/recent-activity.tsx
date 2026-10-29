import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Video, Calendar, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { VideoWithPost } from "@/lib/supabase/types";

interface RecentActivityProps {
  videos: VideoWithPost[];
}

const statusConfig = {
  pending: {
    label: "Pending",
    icon: Loader2,
    variant: "secondary" as const,
  },
  generating: {
    label: "Generating",
    icon: Loader2,
    variant: "default" as const,
  },
  completed: {
    label: "Completed",
    icon: CheckCircle,
    variant: "default" as const,
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    variant: "destructive" as const,
  },
};

function isLocalVideo(video: VideoWithPost): boolean {
  const styleOptions = video.style_options as Record<string, unknown> | null;
  return styleOptions?.apiVersion === "local";
}

export function RecentActivity({ videos }: RecentActivityProps) {
  if (videos.length === 0) {
    return (
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Video className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground">
              No videos yet. Start by adding an RSS feed or blog URL.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="divide-y divide-border">
            {videos.map((video) => {
              const status = statusConfig[video.status];
              const StatusIcon = status.icon;
              const statusLabel =
                isLocalVideo(video) &&
                (video.status === "pending" || video.status === "generating")
                  ? "Rendering locally…"
                  : status.label;

              return (
                <div
                  key={video.id}
                  className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Video className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {video.blog_posts.title}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(video.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={status.variant} className="gap-1">
                    <StatusIcon
                      className={`h-3 w-3 ${
                        video.status === "generating" ? "animate-spin" : ""
                      }`}
                    />
                    {statusLabel}
                  </Badge>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
