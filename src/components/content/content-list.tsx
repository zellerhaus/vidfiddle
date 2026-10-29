"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
} from "lucide-react";
import { SegmentSelector } from "./segment-selector";
import { SegmentPreview } from "./segment-preview";
import type { BlogPostWithFeed, ContentSegment } from "@/lib/supabase/types";

interface ContentListProps {
  posts: BlogPostWithFeed[];
}

const statusConfig = {
  new: { label: "New", variant: "default" as const },
  converting: { label: "Converting", variant: "secondary" as const },
  converted: { label: "Converted", variant: "outline" as const },
  ignored: { label: "Ignored", variant: "secondary" as const },
};

export function ContentList({ posts }: ContentListProps) {
  const router = useRouter();
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
      <div className="grid gap-4">
        {posts.map((post) => {
          const status = statusConfig[post.status];

          return (
            <Card key={post.id} className="hover:bg-muted/30 transition-colors">
              <CardContent className="flex items-start gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                  <FileText className="h-5 w-5 text-primary" />
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
