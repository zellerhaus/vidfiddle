"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  AudioLines,
  Brain,
  Scissors,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

interface StatusData {
  id: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  title: string | null;
  channelName: string | null;
  durationSeconds: number | null;
  status: string;
  errorMessage: string | null;
  clips: {
    total: number;
    pending: number;
    cutting: number;
    renderingCaptions: number;
    completed: number;
    failed: number;
  };
  createdAt: string;
}

const LEGACY_PIPELINE_STEPS = [
  {
    key: "pending",
    label: "Queued",
    icon: Loader2,
    description: "Waiting to start",
  },
  {
    key: "downloading",
    label: "Downloading",
    icon: Download,
    description: "Downloading video from YouTube",
  },
  {
    key: "transcribing",
    label: "Transcribing",
    icon: AudioLines,
    description: "Generating word-level transcript",
  },
  {
    key: "analyzing",
    label: "Analyzing",
    icon: Brain,
    description: "Detecting viral moments with AI",
  },
  {
    key: "processing",
    label: "Processing Clips",
    icon: Scissors,
    description: "Cutting clips and rendering captions",
  },
  {
    key: "completed",
    label: "Complete",
    icon: CheckCircle2,
    description: "All clips ready for review",
  },
];

const SUBMAGIC_PIPELINE_STEPS = [
  {
    key: "submagic_processing",
    label: "Processing",
    icon: Sparkles,
    description: "Detecting clips, adding captions & face tracking",
  },
  {
    key: "completed",
    label: "Complete",
    icon: CheckCircle2,
    description: "All clips ready for review",
  },
];

interface ProcessingStatusProps {
  sourceId: string;
  pipeline?: "submagic" | "legacy";
}

export function ProcessingStatus({ sourceId, pipeline = "legacy" }: ProcessingStatusProps) {
  const PIPELINE_STEPS = pipeline === "submagic" ? SUBMAGIC_PIPELINE_STEPS : LEGACY_PIPELINE_STEPS;
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/youtube/${sourceId}/status`);
      if (!response.ok) throw new Error("Failed to fetch status");
      const data: StatusData = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, [sourceId]);

  useEffect(() => {
    fetchStatus();

    // Poll every 5 seconds while processing
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </CardContent>
      </Card>
    );
  }

  const currentStepIndex = PIPELINE_STEPS.findIndex(
    (s) => s.key === status.status
  );
  const isFailed = status.status === "failed";

  return (
    <div className="space-y-6">
      {/* Video Info */}
      {status.title && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{status.title}</CardTitle>
            <div className="text-sm text-muted-foreground">
              {status.channelName && <span>{status.channelName}</span>}
              {status.durationSeconds && (
                <span>
                  {" "}
                  &middot; {Math.floor(status.durationSeconds / 60)}:
                  {(status.durationSeconds % 60).toString().padStart(2, "0")}
                </span>
              )}
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Pipeline Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Processing Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isFailed ? (
            <div className="flex items-center gap-3 text-destructive">
              <XCircle className="h-5 w-5" />
              <div>
                <div className="font-medium">Processing failed</div>
                <div className="text-sm">{status.errorMessage}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {PIPELINE_STEPS.map((step, index) => {
                const isActive = step.key === status.status;
                const isComplete = index < currentStepIndex;
                const Icon = step.icon;

                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        isComplete
                          ? "bg-primary text-primary-foreground"
                          : isActive
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isActive && step.key !== "completed" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isComplete ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Icon className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div
                        className={`text-sm font-medium ${
                          isActive
                            ? "text-foreground"
                            : isComplete
                              ? "text-foreground"
                              : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </div>
                      {isActive && (
                        <div className="text-xs text-muted-foreground">
                          {step.description}
                        </div>
                      )}
                    </div>
                    {isActive && step.key !== "completed" && (
                      <Badge variant="secondary">In Progress</Badge>
                    )}
                    {isComplete && (
                      <Badge variant="outline" className="text-primary">
                        Done
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clip Summary */}
      {status.clips.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Scissors className="h-5 w-5" />
              Clips ({status.clips.completed}/{status.clips.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{status.clips.total}</div>
                <div className="text-xs text-muted-foreground">Detected</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">
                  {status.clips.completed}
                </div>
                <div className="text-xs text-muted-foreground">Ready</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {status.clips.cutting + status.clips.renderingCaptions}
                </div>
                <div className="text-xs text-muted-foreground">Processing</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
