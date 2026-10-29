"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ScriptStep } from "./steps/script-step";
import { StyleStep, type StyleOptions } from "./steps/style-step";
import { VideoStep } from "./steps/video-step";
import { CaptionsStep } from "./steps/captions-step";
import { ScheduleStep } from "./steps/schedule-step";
import type { BlogPost, Platform, Video, ContentSegment } from "@/lib/supabase/types";

interface ConversionWizardProps {
  post: BlogPost;
  existingVideo?: Video | null;
  segment?: ContentSegment | null;
}

type Step = "script" | "style" | "video" | "captions" | "schedule";

const steps: { id: Step; title: string }[] = [
  { id: "script", title: "Script" },
  { id: "style", title: "Style" },
  { id: "video", title: "Video" },
  { id: "captions", title: "Captions" },
  { id: "schedule", title: "Schedule" },
];

interface ConversionState {
  script: string;
  styleOptions: StyleOptions | null;
  videoId: string | null;
  videoUrl: string | null;
  captions: Record<Platform, string>;
  selectedPlatforms: Platform[];
}

const initialCaptions: Record<Platform, string> = {
  instagram: "",
  tiktok: "",
  youtube: "",
  linkedin: "",
  twitter: "",
  facebook: "",
};

function getInitialStep(video: Video | null | undefined): Step {
  if (!video) return "script";

  // If video is completed, go to captions step
  if (video.status === "completed" && video.video_url) {
    return "captions";
  }

  // If video is generating or pending, go to video step to show progress
  if (video.status === "generating" || video.status === "pending") {
    return "video";
  }

  // If video failed, start from script to try again
  if (video.status === "failed") {
    return "script";
  }

  return "script";
}

function getInitialState(
  post: BlogPost,
  video: Video | null | undefined
): ConversionState {
  // Try to get style options from video.style_options (JSON)
  let styleOptions: StyleOptions | null = null;

  if (video?.style_options && typeof video.style_options === "object") {
    const opts = video.style_options as Record<string, unknown>;
    styleOptions = {
      apiMethod: ((opts.apiVersion as string) || "ai_shorts") as StyleOptions["apiMethod"],
      creatifyStyle: (opts.creatifyStyle as StyleOptions["creatifyStyle"]) || "4K realistic",
      visualStyle: (opts.visualStyle as string) || undefined,
      videoLength: (opts.videoLength as number) || undefined,
      avatarId: (opts.avatarId as string) || null,
      aspectRatio: (opts.aspectRatio as StyleOptions["aspectRatio"]) || "9x16",
      voiceoverVolume: (opts.voiceoverVolume as number) ?? 1.0,
      backgroundMusicVolume: (opts.backgroundMusicVolume as number) ?? 0.3,
      voiceId:
        (opts.voice as string) ||
        (opts.accentId as string) ||
        (opts.voiceId as string) ||
        null,
    };
  } else if (video) {
    // If we have a video but no style_options stored, use defaults
    // This ensures we can resume even if style_options wasn't saved
    styleOptions = {
      apiMethod: "ai_shorts",
      creatifyStyle: "4K realistic",
      aspectRatio: "9x16",
      voiceoverVolume: 1.0,
      backgroundMusicVolume: 0.3,
      voiceId: null,
    };
  }

  // Get cached captions from video if available
  let cachedCaptions = initialCaptions;
  if (video?.generated_captions && typeof video.generated_captions === "object") {
    cachedCaptions = {
      ...initialCaptions,
      ...(video.generated_captions as Record<Platform, string>),
    };
  }

  return {
    script: video?.script || post.generated_script || "",
    styleOptions,
    videoId: video?.id || null,
    videoUrl: video?.video_url || null,
    captions: cachedCaptions,
    selectedPlatforms: [],
  };
}

export function ConversionWizard({ post, existingVideo, segment }: ConversionWizardProps) {
  const router = useRouter();

  // Compute initial step and state based on existing video
  const initialStep = useMemo(() => getInitialStep(existingVideo), [existingVideo]);
  const initialState = useMemo(() => getInitialState(post, existingVideo), [post, existingVideo]);

  const [currentStep, setCurrentStep] = useState<Step>(initialStep);
  const [state, setState] = useState<ConversionState>(initialState);

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  function goToStep(step: Step) {
    const stepIndex = steps.findIndex((s) => s.id === step);
    if (stepIndex <= currentStepIndex + 1) {
      setCurrentStep(step);
    }
  }

  function handleScriptComplete(script: string) {
    setState((prev) => ({ ...prev, script }));
    setCurrentStep("style");
  }

  function handleStyleComplete(options: StyleOptions) {
    setState((prev) => ({ ...prev, styleOptions: options }));
    setCurrentStep("video");
  }

  function handleVideoComplete(videoId: string, videoUrl: string) {
    setState((prev) => ({ ...prev, videoId, videoUrl }));
    setCurrentStep("captions");
  }

  function handleCaptionsComplete(
    captions: Record<Platform, string>,
    platforms: Platform[]
  ) {
    setState((prev) => ({
      ...prev,
      captions,
      selectedPlatforms: platforms,
    }));
    setCurrentStep("schedule");
  }

  function handleScheduleComplete() {
    toast.success("Video scheduled successfully!");
    router.push("/history");
  }

  return (
    <div className="flex h-full">
      {/* Sidebar with steps */}
      <div className="w-64 border-r border-border bg-card p-4">
        <nav className="space-y-1">
          {steps.map((step, index) => {
            const isActive = step.id === currentStep;
            const isCompleted = index < currentStepIndex;
            const isAccessible = index <= currentStepIndex + 1;

            return (
              <button
                key={step.id}
                onClick={() => isAccessible && goToStep(step.id)}
                disabled={!isAccessible}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left",
                  isActive && "bg-primary/10 text-primary",
                  isCompleted && !isActive && "text-foreground",
                  !isActive && !isCompleted && "text-muted-foreground",
                  isAccessible && !isActive && "hover:bg-muted",
                  !isAccessible && "cursor-not-allowed opacity-50"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isActive && "bg-primary text-primary-foreground",
                    isCompleted && !isActive && "bg-green-500 text-white",
                    !isActive && !isCompleted && "bg-muted"
                  )}
                >
                  {isCompleted && !isActive ? "✓" : index + 1}
                </span>
                {step.title}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-12">
        {currentStep === "script" && (
          <ScriptStep post={post} segment={segment} onComplete={handleScriptComplete} />
        )}
        {currentStep === "style" && (
          <StyleStep
            script={state.script}
            onComplete={handleStyleComplete}
            onBack={() => setCurrentStep("script")}
          />
        )}
        {currentStep === "video" && state.styleOptions && (
          <VideoStep
            postId={post.id}
            segmentId={segment?.id}
            script={state.script}
            styleOptions={state.styleOptions}
            existingVideoId={state.videoId}
            existingVideoUrl={state.videoUrl}
            onComplete={handleVideoComplete}
            onBack={() => setCurrentStep("style")}
          />
        )}
        {currentStep === "captions" && state.videoId && (
          <CaptionsStep
            post={post}
            script={state.script}
            videoId={state.videoId}
            initialCaptions={state.captions}
            onComplete={handleCaptionsComplete}
            onBack={() => setCurrentStep("video")}
          />
        )}
        {currentStep === "schedule" && (
          <ScheduleStep
            videoId={state.videoId!}
            videoUrl={state.videoUrl!}
            captions={state.captions}
            platforms={state.selectedPlatforms}
            onComplete={handleScheduleComplete}
            onBack={() => setCurrentStep("captions")}
          />
        )}
      </div>
    </div>
  );
}
