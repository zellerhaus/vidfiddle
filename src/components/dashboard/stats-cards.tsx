import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Video, Calendar, Loader2, Zap } from "lucide-react";

interface StatsCardsProps {
  pendingContent: number;
  videosInProgress: number;
  scheduledPosts: number;
  totalVideos: number;
  autoQueuePending?: number;
}

export function StatsCards({
  pendingContent,
  videosInProgress,
  scheduledPosts,
  totalVideos,
  autoQueuePending = 0,
}: StatsCardsProps) {
  const stats = [
    {
      title: "Pending Content",
      value: pendingContent,
      description: "Blog posts ready to convert",
      icon: FileText,
      color: "text-blue-500",
      href: "/content",
    },
    {
      title: "In Progress",
      value: videosInProgress,
      description: "Videos being generated",
      icon: Loader2,
      color: "text-yellow-500",
      href: "/history",
    },
    {
      title: "Scheduled",
      value: scheduledPosts,
      description: "Posts queued for publishing",
      icon: Calendar,
      color: "text-green-500",
      href: "/calendar",
    },
    {
      title: "Total Videos",
      value: totalVideos,
      description: "Videos created all time",
      icon: Video,
      color: "text-purple-500",
      href: "/history",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.title} href={stat.href}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Auto Queue Status */}
      {autoQueuePending > 0 && (
        <Link href="/settings/auto-mode">
          <Card className="border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                Auto Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{autoQueuePending}</div>
              <p className="text-xs text-muted-foreground">
                Videos pending auto-generation
              </p>
            </CardContent>
          </Card>
        </Link>
      )}
    </div>
  );
}
