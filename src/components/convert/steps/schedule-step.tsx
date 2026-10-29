"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, CheckCircle, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import type { Platform } from "@/lib/supabase/types";

interface ScheduleStepProps {
  videoId: string;
  videoUrl: string;
  captions: Record<Platform, string>;
  platforms: Platform[];
  onComplete: () => void;
  onBack: () => void;
}

interface PublerAccount {
  id: string;
  name: string;
  platform: string;
  avatar?: string;
}

const platformLabels: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  linkedin: "LinkedIn",
  twitter: "Twitter/X",
  facebook: "Facebook",
};

// Platform matching - now the server normalizes platform names, so we just match directly
const platformMatches = (accountPlatform: string, targetPlatform: Platform): boolean => {
  // Server already maps ig_business -> instagram, in_page -> linkedin, etc.
  return accountPlatform === targetPlatform;
};

export function ScheduleStep({
  videoId,
  videoUrl,
  captions,
  platforms,
  onComplete,
  onBack,
}: ScheduleStepProps) {
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduledTimes, setScheduledTimes] = useState<Record<Platform, string>>({} as Record<Platform, string>);
  const [accounts, setAccounts] = useState<PublerAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<Platform, string>>({} as Record<Platform, string>);

  // Fetch Publer accounts on mount
  useEffect(() => {
    async function fetchAccounts() {
      try {
        const response = await fetch("/api/schedule");
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to fetch accounts");
        }
        const data = await response.json();
        setAccounts(data.accounts || []);

        // Auto-select first matching account for each platform
        const autoSelected: Record<Platform, string> = {} as Record<Platform, string>;
        for (const platform of platforms) {
          const matchingAccount = data.accounts?.find(
            (acc: PublerAccount) => platformMatches(acc.platform, platform)
          );
          if (matchingAccount) {
            autoSelected[platform] = matchingAccount.id;
          }
        }
        setSelectedAccounts(autoSelected);
        console.log("[Schedule] Auto-selected accounts:", autoSelected);

        // Log accounts for debugging
        console.log("Publer accounts:", data.accounts);
      } catch (error) {
        setAccountError(error instanceof Error ? error.message : "Failed to load accounts");
      } finally {
        setLoadingAccounts(false);
      }
    }
    fetchAccounts();
  }, [platforms]);

  // Check if all platforms have an account selected
  const allPlatformsHaveAccount = platforms.every((p) => selectedAccounts[p]);
  const missingPlatforms = platforms.filter((p) => !selectedAccounts[p]);

  async function scheduleAll() {
    if (!allPlatformsHaveAccount) {
      toast.error("Please connect accounts for all platforms in Publer");
      return;
    }

    setIsScheduling(true);
    try {
      const requestBody = {
        videoId,
        posts: platforms.map((platform) => ({
          platform,
          accountId: selectedAccounts[platform],
          caption: captions[platform],
        })),
      };

      console.log("[Schedule] Sending request:", JSON.stringify(requestBody, null, 2));

      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      console.log("[Schedule] Response status:", response.status);
      console.log("[Schedule] Response data:", JSON.stringify(data, null, 2));

      if (!response.ok) {
        const errorMsg = data.details
          ? `${data.error}: ${data.details}`
          : data.error || "Failed to schedule posts";
        throw new Error(errorMsg);
      }

      setScheduledTimes(data.scheduledTimes || {});
      setScheduled(true);
      toast.success("Posts scheduled successfully!");
      console.log("[Schedule] Success! Publer job ID:", data.publerJobId);
    } catch (error) {
      console.error("[Schedule] Error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to schedule posts");
    } finally {
      setIsScheduling(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schedule Posts
          </CardTitle>
          <CardDescription>
            Schedule your video to be posted at optimal times via Publer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Video Preview */}
          <div className="flex gap-4">
            <div className="w-32 h-56 rounded-lg overflow-hidden bg-black flex-shrink-0">
              <video src={videoUrl} className="h-full w-full object-cover" muted />
            </div>
            <div className="flex-1">
              <h4 className="font-medium mb-2">Posting to:</h4>
              <div className="flex flex-wrap gap-2">
                {platforms.map((platform) => {
                  const hasAccount = selectedAccounts[platform];
                  return (
                    <Badge
                      key={platform}
                      variant={hasAccount ? "secondary" : "destructive"}
                    >
                      {platformLabels[platform]}
                      {!hasAccount && " (no account)"}
                    </Badge>
                  );
                })}
              </div>

              {scheduled && (
                <div className="mt-4 space-y-2">
                  <h4 className="font-medium text-green-600 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Scheduled!
                  </h4>
                  <div className="space-y-1 text-sm">
                    {platforms.map((platform) => (
                      <p key={platform} className="text-muted-foreground">
                        {platformLabels[platform]}:{" "}
                        {scheduledTimes[platform] || "Optimal time"}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {loadingAccounts && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-muted-foreground">Loading Publer accounts...</span>
            </div>
          )}

          {accountError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">{accountError}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Make sure Publer is configured with your API key in the settings.
              </p>
            </div>
          )}

          {!loadingAccounts && !accountError && missingPlatforms.length > 0 && (
            <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
              <div className="flex items-center gap-2 text-yellow-600">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Missing accounts</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Connect these platforms in Publer to schedule:{" "}
                {missingPlatforms.map((p) => platformLabels[p]).join(", ")}
              </p>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <a
                  href="https://publer.io/accounts"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Connect in Publer
                  <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          )}

          {!scheduled && !loadingAccounts && !accountError ? (
            <div className="rounded-lg border p-4 bg-muted/30">
              <h4 className="font-medium mb-2">Auto-Scheduling</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Publer will automatically choose the optimal posting time for each
                platform based on your audience's activity patterns.
              </p>
              <Button
                onClick={scheduleAll}
                disabled={isScheduling || !allPlatformsHaveAccount}
                className="w-full"
              >
                {isScheduling ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Scheduling...
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4 mr-2" />
                    Schedule with Optimal Times
                  </>
                )}
              </Button>
            </div>
          ) : scheduled ? (
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-green-600">All Done!</h4>
                  <p className="text-sm text-muted-foreground">
                    Your posts have been added to the Publer queue.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://publer.io/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View in Publer
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" onClick={onBack} disabled={isScheduling}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Captions
            </Button>
            {scheduled && (
              <Button onClick={onComplete}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Finish
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
