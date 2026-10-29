"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Loader2, Scissors } from "lucide-react";
import type { ContentSegment } from "@/lib/supabase/types";

interface SegmentSelectorProps {
  blogPostId: string;
  onSegmentsGenerated: (segments: ContentSegment[]) => void;
  disabled?: boolean;
}

export function SegmentSelector({
  blogPostId,
  onSegmentsGenerated,
  disabled = false,
}: SegmentSelectorProps) {
  const [segmentCount, setSegmentCount] = useState(3);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerateSegments() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/content/${blogPostId}/segment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSegments: segmentCount }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate segments");
      }

      const data = await response.json();
      onSegmentsGenerated(data.segments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate segments");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="segment-count">Number of Videos</Label>
          <span className="text-sm font-medium tabular-nums">{segmentCount}</span>
        </div>
        <Slider
          id="segment-count"
          min={1}
          max={5}
          step={1}
          value={[segmentCount]}
          onValueChange={([value]) => setSegmentCount(value)}
          disabled={disabled || isLoading}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1 video</span>
          <span>5 videos</span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button
        onClick={handleGenerateSegments}
        disabled={disabled || isLoading}
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generating Segments...
          </>
        ) : (
          <>
            <Scissors className="h-4 w-4 mr-2" />
            Generate {segmentCount} Segment{segmentCount !== 1 ? "s" : ""}
          </>
        )}
      </Button>
    </div>
  );
}
