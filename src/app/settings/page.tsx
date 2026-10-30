import Link from "next/link";
import { AppLayout, Header } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ExternalLink, CheckCircle, XCircle, ChevronRight, Sparkles, Zap } from "lucide-react";
import { getPublisher, type PublisherAccount } from "@/lib/publishers";
import { isLLMConfigured, llmProviderName } from "@/lib/llm";
import { isLocalEngineConfigured } from "@/lib/local-engine";
import { getStorageDriver } from "@/lib/storage";
import { listTracks } from "@/lib/video-engine/music";
import { join, resolve } from "node:path";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import type { Platform } from "@/lib/supabase/types";
import { VideoDefaultsForm } from "@/components/settings";

async function getSettings() {
  // Check environment variables
  const llmProvider = llmProviderName();
  const llmProviderLabel = llmProvider === "openai"
    ? "OpenAI"
    : llmProvider === "anthropic"
      ? "Anthropic"
      : "Anthropic/OpenAI";
  const llmConfigEnvVar = llmProvider === "openai"
    ? "OPENAI_API_KEY"
    : llmProvider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : "ANTHROPIC_API_KEY or OPENAI_API_KEY";

  // The active publisher's accounts (LightPost or Publer, whichever getPublisher picks)
  const publisher = getPublisher();
  let accounts: PublisherAccount[] = [];
  let accountsError = false;
  if (publisher) {
    try {
      accounts = await publisher.getAccounts();
    } catch (error) {
      accountsError = true;
      console.error(`Failed to fetch ${publisher.name} accounts:`, error);
    }
  }

  // Music: your folder (MUSIC_DIR) plus the bundled starter tracks; ElevenLabs takes over when keyed.
  const userMusicDir = process.env.MUSIC_DIR || join(process.env.DATA_DIR || "data", "music");
  const [userTracks, bundledTracks] = await Promise.all([listTracks([userMusicDir]), listTracks([resolve("assets/music")])]);
  const elevenLabsMusic = !!process.env.ELEVENLABS_API_KEY && process.env.MUSIC_PROVIDER?.toLowerCase() !== "library";

  return {
    music: { userTracks: userTracks.length, bundledTracks: bundledTracks.length, elevenLabs: elevenLabsMusic },
    elevenLabs: !!process.env.ELEVENLABS_API_KEY,
    llm: {
      connected: isLLMConfigured(),
      provider: llmProvider,
      providerLabel: llmProviderLabel,
      configEnvVar: llmConfigEnvVar,
    },
    localEngine: isLocalEngineConfigured(),
    creatify: !!process.env.CREATIFY_API_ID && !!process.env.CREATIFY_API_KEY,
    lightpostConfigured: !!process.env.LIGHTPOST_URL,
    publerConfigured: !!process.env.PUBLER_API_KEY && !!process.env.PUBLER_WORKSPACE_ID,
    activePublisher: publisher?.name ?? null,
    accounts,
    accountsError,
    storage: getStorageDriver(),
  };
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

interface ConnectionRow {
  key: string;
  initials: string;
  tile: string;
  name: string;
  description: string;
  status: { tone: "success" | "info" | "secondary"; label: string };
}

function connectionRows(settings: Settings): ConnectionRow[] {
  const publisherStatus = (name: "lightpost" | "publer", configured: boolean): ConnectionRow["status"] => {
    if (settings.activePublisher === name) {
      if (settings.accountsError) return { tone: "secondary", label: "Can't reach it" };
      const n = settings.accounts.length;
      return { tone: "success", label: `Active · ${n} account${n === 1 ? "" : "s"}` };
    }
    return configured ? { tone: "info", label: "Configured" } : { tone: "secondary", label: "Not configured" };
  };

  return [
    {
      key: "llm",
      initials: settings.llm.provider === "anthropic" ? "A" : "AI",
      tile: "bg-pastel-blue",
      name: `${settings.llm.providerLabel} text model`,
      description: `Writes scripts and captions. Set ${settings.llm.configEnvVar}.`,
      status: settings.llm.connected ? { tone: "success", label: "Connected" } : { tone: "secondary", label: "Not configured" },
    },
    {
      key: "local",
      initials: "VF",
      tile: "bg-pastel-yellow",
      name: "Local engine",
      description: "Renders videos on your server with OpenAI voice, images and captions.",
      status: settings.localEngine ? { tone: "success", label: "Ready" } : { tone: "secondary", label: "Needs OPENAI_API_KEY" },
    },
    {
      key: "elevenlabs",
      initials: "11",
      tile: "bg-white",
      name: "ElevenLabs (optional)",
      description: "Voiceover voices from your ElevenLabs account, and music composed per video.",
      status: settings.elevenLabs ? { tone: "success", label: "Connected" } : { tone: "secondary", label: "Not configured" },
    },
    {
      key: "music",
      initials: "♪",
      tile: "bg-pastel-pink",
      name: "Music",
      description: settings.music.elevenLabs
        ? "ElevenLabs composes a track for each video; your library is the fallback."
        : `Picked by mood from ${settings.music.bundledTracks} starter track${settings.music.bundledTracks === 1 ? "" : "s"} and ${settings.music.userTracks} of yours (MUSIC_DIR).`,
      status: settings.music.elevenLabs
        ? { tone: "success", label: "ElevenLabs" }
        : settings.music.bundledTracks + settings.music.userTracks > 0
          ? { tone: "success", label: `${settings.music.bundledTracks + settings.music.userTracks} track${settings.music.bundledTracks + settings.music.userTracks === 1 ? "" : "s"}` }
          : { tone: "secondary", label: "No tracks" },
    },
    {
      key: "lightpost",
      initials: "LP",
      tile: "bg-pastel-green",
      name: "LightPost",
      description: "Self-hosted scheduler that posts to your social accounts.",
      status: publisherStatus("lightpost", settings.lightpostConfigured),
    },
    {
      key: "publer",
      initials: "P",
      tile: "bg-[#ffb3a6]",
      name: "Publer",
      description: "Hosted scheduler that posts to your social accounts.",
      status: publisherStatus("publer", settings.publerConfigured),
    },
    {
      key: "creatify",
      initials: "Cr",
      tile: "bg-pastel-cream",
      name: "Creatify (optional)",
      description: "Paid engine for AI Shorts, Link to Video and AI Avatar videos.",
      status: settings.creatify ? { tone: "success", label: "Connected" } : { tone: "secondary", label: "Not configured" },
    },
    {
      key: "storage",
      initials: settings.storage === "s3" ? "S3" : "HD",
      tile: "bg-white",
      name: "Media storage",
      description: settings.storage === "s3" ? "S3-compatible bucket (STORAGE_DRIVER=s3)." : "Local disk under DATA_DIR.",
      status: { tone: "info", label: settings.storage === "s3" ? "S3" : "Local disk" },
    },
  ];
}

export default async function SettingsPage() {
  const settings = await getSettings();
  const rows = connectionRows(settings);
  const envLines: { name: string; set: boolean; note?: string }[] = [
    { name: settings.llm.configEnvVar, set: settings.llm.connected },
    { name: "PUBLISHER", set: !!settings.activePublisher, note: "lightpost or publer" },
    { name: "LIGHTPOST_URL", set: settings.lightpostConfigured },
    { name: "PUBLER_API_KEY", set: settings.publerConfigured },
    { name: "STORAGE_DRIVER", set: settings.storage === "s3", note: "local (default) or s3" },
    { name: "ELEVENLABS_API_KEY", set: settings.elevenLabs, note: "optional: ElevenLabs voices and music" },
    { name: "CREATIFY_API_KEY", set: settings.creatify, note: "optional" },
  ];

  return (
    <AppLayout>
      <Header title="Settings" description="Manage your integrations and preferences" />
      <div className="flex-1 overflow-auto p-12">
        <div className="max-w-2xl space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Connections</CardTitle>
              <CardDescription>
                Everything is configured with environment variables; this page shows what Vidfiddle found.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {rows.map((row, i) => (
                <div key={row.key} className="space-y-4">
                  {i > 0 && <Separator />}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black ${row.tile}`}>
                        <span className="label-chrome text-xs font-bold">{row.initials}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold">{row.name}</p>
                        <p className="text-sm text-muted-foreground">{row.description}</p>
                      </div>
                    </div>
                    <Badge variant={row.status.tone} className="gap-1">
                      {row.status.tone === "success" ? <CheckCircle className="h-3 w-3" /> : row.status.tone === "secondary" ? <XCircle className="h-3 w-3" /> : null}
                      {row.status.label}
                    </Badge>
                  </div>

                  {/* Accounts on the active publisher */}
                  {(row.key === settings.activePublisher) && settings.accounts.length > 0 && (
                    <div className="space-y-2 pl-[52px]">
                      {settings.accounts.map((account) => (
                        <div key={account.id} className="flex items-center gap-3 border-2 border-black bg-white p-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={account.avatar_url} />
                            <AvatarFallback
                              className={`${PLATFORM_COLORS[account.platform as Platform] ?? "bg-muted text-black"} text-xs`}
                            >
                              {(account.platform || "??").slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {account.name || account.username}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {account.platform || "Unknown"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>More Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href="/settings/brand"
                className="flex items-center justify-between border-2 border-transparent p-3 transition-colors hover:border-black hover:bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-pastel-pink">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold">Brand Voice Guidelines</p>
                    <p className="text-sm text-muted-foreground">
                      Customize script generation with your brand voice
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5" />
              </Link>

              <Link
                href="/settings/auto-mode"
                className="flex items-center justify-between border-2 border-transparent p-3 transition-colors hover:border-black hover:bg-white"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-pastel-yellow">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold">Auto Mode Status</p>
                    <p className="text-sm text-muted-foreground">
                      Monitor automatic video generation and cron jobs
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Environment Setup</CardTitle>
              <CardDescription>
                Set these in your <code className="font-mono">.env</code> file, then restart the app (<code className="font-mono">docker compose up -d</code>).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-black bg-black p-4 font-mono text-sm text-white space-y-1">
                <p className="text-white/60"># .env</p>
                {envLines.map((line) => (
                  <p key={line.name} className={line.set ? "text-pastel-green" : ""}>
                    {line.name}={line.set ? "✓ set" : "…"}
                    {line.note && <span className="text-white/50">{`  # ${line.note}`}</span>}
                  </p>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Every variable is documented in <code className="font-mono">.env.example</code>. Get keys here:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                    OpenAI keys
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href="https://github.com/brainstormity/LightPost" target="_blank" rel="noopener noreferrer">
                    LightPost
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href="https://publer.com/docs" target="_blank" rel="noopener noreferrer">
                    Publer API
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href="https://creatify.ai/api" target="_blank" rel="noopener noreferrer">
                    Creatify
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Video Defaults</CardTitle>
              <CardDescription>
                Configure default settings for all new video generations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VideoDefaultsForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
