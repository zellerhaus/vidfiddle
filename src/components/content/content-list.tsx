"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  MoreVertical,
  Video,
  EyeOff,
  ExternalLink,
  Calendar,
  ChevronDown,
  Layers,
  Loader2,
} from "lucide-react";
import { SegmentSelector } from "./segment-selector";
import { SegmentPreview } from "./segment-preview";
import type { BlogPostWithFeed, ContentSegment } from "@/lib/supabase/types";

interface ContentListProps {
  posts: BlogPostWithFeed[];
  /** Show checkboxes and bulk actions (the New tab). */
  selectable?: boolean;
}

const statusConfig = {
  new: { label: "New", variant: "default" as const },
  converting: { label: "Converting", variant: "info" as const },
  converted: { label: "Converted", variant: "success" as const },
  ignored: { label: "Ignored", variant: "secondary" as const },
};

export function ContentList({ posts, selectable = false }: ContentListProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"create_videos" | "ignore" | null>(null);
  // Posts can leave the list after a refresh; only count ones still shown.
  const selectedIds = posts.filter((post) => selected.has(post.id)).map((post) => post.id);
  const allSelected = posts.length > 0 && selectedIds.length === posts.length;

  function toggle(postId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(postId);
      else next.delete(postId);
      return next;
    });
  }

  async function runBulk(action: "create_videos" | "ignore") {
    setBulkAction(action);
    try {
      const response = await fetch("/api/content/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, postIds: selectedIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update the selected posts");

      if (action === "ignore") {
        toast.success(`Ignored ${data.ignored} ${data.ignored === 1 ? "post" : "posts"}`);
      } else {
        const skipped = data.skipped ? ` Skipped ${data.skipped} that already had a video or were queued.` : "";
        if (data.queued > 0) {
          toast.success(`Creating ${data.queued} ${data.queued === 1 ? "video" : "videos"}`, {
            description: `Each one goes to the Approval Queue when it's ready.${skipped}`,
            action: { label: "Open queue", onClick: () => router.push("/queue") },
          });
        } else {
          toast.info(`Nothing to create.${skipped}`);
        }
      }
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update the selected posts");
    } finally {
      setBulkAction(null);
    }
  }
  const [multiVideoDialogOpen, setMultiVideoDialogOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [segments, setSegments] = useState<ContentSegment[]>([]);

  function handleMultiVideoClick(postId: string) {
    setSelectedPostId(postId);
    setSegments([]);
    setMultiVideoDialogOpen(true);
  }

  function handleSegmentsGenerated(generatedSegments: ContentSegment[]) {
    setSegments(generatedSegments);
  }

  async function handleIgnore(postId: string) {
    try {
      const response = await fetch(`/api/content/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ignored" }),
      });

      if (!response.ok) {
        throw new Error("Failed to update post");
      }

      toast.success("Post ignored");
      router.refresh();
    } catch (error) {
      toast.error("Failed to ignore post");
    }
  }

  if (posts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No content yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            Add an RSS feed or paste a blog URL to start converting content into
            videos.
          </p>
          <Link href="/content/new">
            <Button>Add Content</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const selectedPost = posts.find((p) => p.id === selectedPostId);

  return (
    <>
      {selectable && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border-2 border-black bg-white px-4 py-3 shadow-hard-sm">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={allSelected ? true : selectedIds.length > 0 ? "indeterminate" : false}
              onCheckedChange={(checked) => setSelected(checked === true ? new Set(posts.map((p) => p.id)) : new Set())}
              aria-label="Select all posts"
            />
            {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select all"}
          </label>
          {selectedIds.length > 0 ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">
                Uses your video defaults from Settings
              </span>
              <Button size="sm" variant="outline" onClick={() => runBulk("ignore")} disabled={bulkAction !== null}>
                {bulkAction === "ignore" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <EyeOff className="h-4 w-4 mr-2" />}
                Ignore
              </Button>
              <Button size="sm" onClick={() => runBulk("create_videos")} disabled={bulkAction !== null}>
                {bulkAction === "create_videos" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Video className="h-4 w-4 mr-2" />}
                Create {selectedIds.length} {selectedIds.length === 1 ? "video" : "videos"}
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Select posts to make a video from each one at once.</span>
          )}
        </div>
      )}
      <div className="grid gap-4">
        {posts.map((post) => {
          const status = statusConfig[post.status];

          return (
            <Card key={post.id} className="hover:bg-muted/30 transition-colors">
              <CardContent className="flex items-start gap-4 p-4">
                {selectable && (
                  <Checkbox
                    checked={selected.has(post.id)}
                    onCheckedChange={(checked) => toggle(post.id, checked === true)}
                    aria-label={`Select ${post.title}`}
                    className="mt-3"
                  />
                )}
                <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-pastel-blue flex-shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{post.title}</p>
                      {post.excerpt && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {post.excerpt}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {post.rss_feeds && (
                          <span className="truncate">
                            From: {post.rss_feeds.title || "RSS Feed"}
                          </span>
                        )}
                        {post.published_at && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(post.published_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {post.status === "new" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm">
                          <Video className="h-4 w-4 mr-2" />
                          Create Video
                          <ChevronDown className="h-4 w-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/convert/${post.id}`} className="cursor-pointer">
                            <Video className="h-4 w-4 mr-2" />
                            Single Video
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleMultiVideoClick(post.id)}
                          className="cursor-pointer"
                        >
                          <Layers className="h-4 w-4 mr-2" />
                          Multiple Videos
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View original
                        </a>
                      </DropdownMenuItem>
                      {post.status === "new" && (
                        <DropdownMenuItem onClick={() => handleIgnore(post.id)}>
                          <EyeOff className="h-4 w-4 mr-2" />
                          Ignore
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Multi-video segmentation dialog */}
      <Dialog open={multiVideoDialogOpen} onOpenChange={setMultiVideoDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Multiple Videos</DialogTitle>
            <DialogDescription>
              {selectedPost?.title
                ? `Segment "${selectedPost.title}" into multiple video scripts`
                : "Segment content into multiple video scripts"}
            </DialogDescription>
          </DialogHeader>

          {segments.length === 0 ? (
            /* Show segment selector when no segments generated yet */
            selectedPostId && (
              <SegmentSelector
                blogPostId={selectedPostId}
                onSegmentsGenerated={handleSegmentsGenerated}
              />
            )
          ) : (
            /* Show segment preview after generation */
            selectedPostId && (
              <SegmentPreview
                segments={segments}
                blogPostId={selectedPostId}
                onSegmentUpdate={(updatedSegment) => {
                  setSegments((prev) =>
                    prev.map((s) =>
                      s.id === updatedSegment.id ? updatedSegment : s
                    )
                  );
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
