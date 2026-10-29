"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ExternalLink, Clock, CheckCircle } from "lucide-react";
import type { Platform } from "@/lib/supabase/types";
import type { CalendarEvent as CalendarEventType } from "./calendar-grid";

interface CalendarEventProps {
  event: CalendarEventType;
  className?: string;
}

// Platform color mapping
const PLATFORM_COLORS: Record<Platform, string> = {
  instagram: "bg-pink-500",
  tiktok: "bg-black dark:bg-gray-800",
  youtube: "bg-red-500",
  linkedin: "bg-blue-600",
  twitter: "bg-sky-500",
  facebook: "bg-blue-500",
};

function formatEventTime(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPublishedDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CalendarEventComponent({ event, className }: CalendarEventProps) {
  const videoTitle = event.scheduledPost?.videos?.blog_posts?.title || event.title;
  const caption = event.scheduledPost?.caption;
  const publishedAt = event.scheduledPost?.published_at;
  const platformUrl = event.scheduledPost?.platform_post_url;
  const videoId = event.scheduledPost?.video_id;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full text-left px-1.5 py-0.5 rounded text-xs text-white truncate hover:opacity-80 transition-opacity",
            PLATFORM_COLORS[event.platform],
            event.status === "posted" && "opacity-75",
            className
          )}
          title={event.title}
        >
          {event.title}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          {/* Header with video title */}
          <div>
            <h4 className="font-semibold text-sm leading-tight">
              {videoTitle}
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              {formatEventTime(event.date)}
            </p>
          </div>

          {/* Platform and Status badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn("text-white text-xs", PLATFORM_COLORS[event.platform])}>
              {event.platform}
            </Badge>
            <Badge variant={event.status === "posted" ? "default" : "outline"} className="text-xs">
              {event.status === "posted" ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Published
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 mr-1" />
                  {event.status}
                </>
              )}
            </Badge>
          </div>

          {/* Caption preview */}
          {caption && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Caption
              </p>
              <p className="text-xs bg-muted p-2 rounded line-clamp-3">
                {caption}
              </p>
            </div>
          )}

          {/* Published timestamp */}
          {publishedAt && (
            <div className="text-xs">
              <span className="text-muted-foreground">Published: </span>
              <span className="font-medium">{formatPublishedDate(publishedAt)}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {platformUrl && (
              <Button variant="outline" size="sm" asChild className="text-xs h-7">
                <a
                  href={platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View Post
                </a>
              </Button>
            )}
            {videoId && (
              <Button variant="outline" size="sm" asChild className="text-xs h-7">
                <a href={`/history?video=${videoId}`}>
                  View in History
                </a>
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
