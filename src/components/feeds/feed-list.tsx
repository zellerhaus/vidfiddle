"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Rss, MoreVertical, Trash2, RefreshCw, ExternalLink, Zap } from "lucide-react";
import type { RssFeed } from "@/lib/supabase/types";

interface FeedListProps {
  feeds: RssFeed[];
}

export function FeedList({ feeds }: FeedListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!deleteId) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/feeds/${deleteId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete feed");
      }

      toast.success("Feed deleted");
      router.refresh();
    } catch (error) {
      toast.error("Failed to delete feed");
    } finally {
      setIsDeleting(false);
      setDeleteId(null);
    }
  }

  async function handleRefresh(feedId: string) {
    toast.info("Checking feed for new posts...");
    try {
      const response = await fetch(`/api/feeds/${feedId}/refresh`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to refresh feed");
      }

      const data = await response.json();
      toast.success(`Found ${data.newPosts} new posts`);
      router.refresh();
    } catch (error) {
      toast.error("Failed to refresh feed");
    }
  }

  if (feeds.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Rss className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No RSS feeds yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Add an RSS feed to automatically monitor blogs for new content to
            convert into videos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        {feeds.map((feed) => (
          <Card key={feed.id}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-pastel-cream">
                <Rss className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {feed.title || "Untitled Feed"}
                </p>
                <p className="text-sm text-muted-foreground truncate">
                  {feed.url}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {feed.auto_mode_enabled ? (
                  <Badge
                    variant="default"
                    className="hidden sm:flex bg-pastel-yellow"
                    title={`${feed.auto_videos_per_post} video(s) per post`}
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    Auto ({feed.auto_videos_per_post}x)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="hidden sm:flex text-muted-foreground">
                    Manual
                  </Badge>
                )}
                {feed.last_checked_at && (
                  <Badge variant="secondary" className="hidden sm:flex">
                    Last checked:{" "}
                    {new Date(feed.last_checked_at).toLocaleDateString()}
                  </Badge>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleRefresh(feed.id)}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Check for new posts
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href={feed.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open feed URL
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setDeleteId(feed.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this feed?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the feed from monitoring. Posts already imported
              from this feed will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
