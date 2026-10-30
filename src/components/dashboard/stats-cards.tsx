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
      color: "bg-pastel-pink",
      href: "/content",
    },
    {
      title: "In Progress",
      value: videosInProgress,
      description: "Videos being generated",
      icon: Loader2,
      color: "bg-pastel-blue",
      href: "/history",
    },
    {
      title: "Scheduled",
      value: scheduledPosts,
      description: "Posts queued for publishing",
      icon: Calendar,
      color: "bg-pastel-green",
      href: "/calendar",
    },
    {
      title: "Total Videos",
      value: totalVideos,
      description: "Videos created all time",
      icon: Video,
      color: "bg-pastel-yellow",
      href: "/history",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.title} href={stat.href}>
            <Card className={`${stat.color} gap-3 py-5 cursor-pointer transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0">
                <CardTitle className="label-chrome text-xs font-semibold">{stat.title}</CardTitle>
                <stat.icon className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="display text-5xl">{stat.value}</div>
                <p className="mt-2 text-xs font-semibold">{stat.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Auto Queue Status */}
      {autoQueuePending > 0 && (
        <Link href="/settings/auto-mode">
          <Card className="bg-pastel-cream cursor-pointer transition-transform hover:-translate-y-0.5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Auto Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="display text-4xl">{autoQueuePending}</div>
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
