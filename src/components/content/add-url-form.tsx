"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link2, ArrowRight } from "lucide-react";

export function AddUrlForm() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);

    try {
      const response = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to extract content");
      }

      const post = await response.json();
      toast.success("Content extracted successfully!");
      router.push(`/convert/${post.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to extract content"
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Add Blog Post URL
        </CardTitle>
        <CardDescription>
          Paste a blog post URL to extract content and convert it to a video.
          Works best with WordPress, Medium, Substack, and most standard blog
          platforms.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="blog-url">Blog Post URL</Label>
            <Input
              id="blog-url"
              type="url"
              placeholder="https://example.com/blog/my-awesome-post"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-2"
              disabled={isLoading}
            />
          </div>
          <Button type="submit" disabled={isLoading || !url.trim()}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting content...
              </>
            ) : (
              <>
                Extract & Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
