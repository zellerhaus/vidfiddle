"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, ArrowRight, RefreshCw, Star } from "lucide-react";
import type { BlogPost, ContentSegment, BrandGuideline } from "@/lib/supabase/types";

interface ScriptStepProps {
  post: BlogPost;
  segment?: ContentSegment | null;
  onComplete: (script: string) => void;
}

function estimateDuration(script: string): number {
  // Rough estimate: 150 words per minute for conversational speech
  const words = script.trim().split(/\s+/).length;
  return Math.round((words / 150) * 60);
}

export function ScriptStep({ post, segment, onComplete }: ScriptStepProps) {
  // Initialize with existing script if available
  // If segment has a generated script, use that; otherwise fall back to post script
  const [script, setScript] = useState(
    segment?.generated_script || post.generated_script || ""
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [brandGuidelines, setBrandGuidelines] = useState<BrandGuideline[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>("none");
  const [loadingBrands, setLoadingBrands] = useState(true);

  // Fetch brand guidelines on mount
  useEffect(() => {
    async function fetchBrandGuidelines() {
      try {
        const response = await fetch("/api/brand-guidelines");
        if (response.ok) {
          const data = await response.json();
          setBrandGuidelines(data);
          // Pre-select default if exists
          const defaultGuideline = data.find((g: BrandGuideline) => g.is_default);
          if (defaultGuideline) {
            setSelectedBrandId(defaultGuideline.id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch brand guidelines:", error);
      } finally {
        setLoadingBrands(false);
      }
    }
    fetchBrandGuidelines();
  }, []);

  // Auto-fetch script on mount (will use cache if available)
  useEffect(() => {
    if (!script && !loadingBrands) {
      generateScript(false);
    }
  }, [loadingBrands]);

  async function generateScript(regenerate: boolean = false) {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blogPostId: post.id,
          segmentId: segment?.id,
          regenerate,
          brandGuidelineId: selectedBrandId !== "none" ? selectedBrandId : null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate script");
      }

      const data = await response.json();
      setScript(data.script);
      if (data.fromCache) {
        toast.success("Loaded saved script");
      } else {
        toast.success("Script generated!");
      }
    } catch (error) {
      toast.error("Failed to generate script. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const duration = estimateDuration(script);

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate Video Script
          </CardTitle>
          <CardDescription>
            Generate a 30-60 second video script from your blog post, then edit
            it to your liking.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-4">
            <h4 className="font-medium mb-2">
              Source: {segment ? segment.title : post.title}
            </h4>
            {segment && (
              <p className="text-xs text-primary mb-2">
                Segment {(segment.segment_index ?? 0) + 1} of &ldquo;{post.title}&rdquo;
              </p>
            )}
            <p className="text-sm text-muted-foreground line-clamp-3">
              {segment
                ? segment.content.slice(0, 300)
                : (post.excerpt || post.content.slice(0, 300))}
              ...
            </p>
          </div>

          {/* Brand Guideline Selector */}
          {brandGuidelines.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="brand-guideline">Brand Voice Guideline</Label>
              <Select
                value={selectedBrandId}
                onValueChange={setSelectedBrandId}
                disabled={isGenerating}
              >
                <SelectTrigger id="brand-guideline">
                  <SelectValue placeholder="Select a brand guideline" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    None (generic style)
                  </SelectItem>
                  {brandGuidelines.map((guideline) => (
                    <SelectItem key={guideline.id} value={guideline.id}>
                      <span className="flex items-center gap-2">
                        {guideline.name}
                        {guideline.is_default && (
                          <Star className="h-3 w-3 text-yellow-500" />
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Apply brand voice guidelines to customize the script generation
              </p>
            </div>
          )}

          {!script && !isGenerating && (
            <Button onClick={() => generateScript(false)} disabled={isGenerating || loadingBrands} className="w-full">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Script with Claude
            </Button>
          )}

          {isGenerating && !script && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Generating script...</span>
            </div>
          )}

          {script && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Your Script</span>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{wordCount} words</span>
                    <span>~{duration}s video</span>
                  </div>
                </div>
                <Textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                  placeholder="Your video script will appear here..."
                />
              </div>

              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={() => generateScript(true)}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Regenerate
                </Button>
                <Button onClick={() => onComplete(script)} disabled={!script.trim()}>
                  Continue to Style
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
