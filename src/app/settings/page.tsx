import Link from "next/link";
import { AppLayout, Header } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ExternalLink, CheckCircle, XCircle, ChevronRight, Sparkles, Zap } from "lucide-react";
import { getAccounts, isPublerConfigured, type PublerAccount } from "@/lib/publishers/publer";
import { isLLMConfigured, llmProviderName } from "@/lib/llm";
import { VideoDefaultsForm } from "@/components/settings";

async function getSettings() {
  // Check environment variables
  const llmProvider = llmProviderName();
  const llmConnected = isLLMConfigured();
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
  const creatifyConnected = !!process.env.CREATIFY_API_ID && !!process.env.CREATIFY_API_KEY;
  const publerConfigured = isPublerConfigured();

  // Fetch Publer accounts if configured
  let publerAccounts: PublerAccount[] = [];
  if (publerConfigured) {
    try {
      publerAccounts = await getAccounts();
    } catch (error) {
      console.error("Failed to fetch Publer accounts:", error);
    }
  }

  return {
    llm: {
      connected: llmConnected,
      provider: llmProvider,
      providerLabel: llmProviderLabel,
      configEnvVar: llmConfigEnvVar,
    },
    creatify: { connected: creatifyConnected },
    publer: {
      connected: publerConfigured && publerAccounts.length > 0,
      configured: publerConfigured,
      accounts: publerAccounts,
    },
  };
}

// Platform icons/colors
const platformColors: Record<string, string> = {
  instagram: "bg-pink-500",
  tiktok: "bg-black",
  youtube: "bg-red-500",
  linkedin: "bg-blue-600",
  twitter: "bg-sky-500",
  facebook: "bg-blue-500",
};

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <AppLayout>
      <Header title="Settings" description="Manage your integrations and preferences" />
      <div className="flex-1 overflow-auto p-12">
        <div className="max-w-2xl space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>API Connections</CardTitle>
              <CardDescription>
                Connect your external services to enable video generation and social posting.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Text LLM */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                    <span className="text-lg font-semibold text-purple-500">
                      {settings.llm.provider === "openai"
                        ? "O"
                        : settings.llm.provider === "anthropic"
                          ? "A"
                          : "T"}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium">{settings.llm.providerLabel} Text Model</p>
                    <p className="text-sm text-muted-foreground">
                      Active provider via {settings.llm.configEnvVar}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={settings.llm.connected ? "default" : "secondary"}
                  className="gap-1"
                >
                  {settings.llm.connected ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Connected
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3" />
                      Not configured
                    </>
                  )}
                </Badge>
              </div>

              <Separator />

              {/* Creatify */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <span className="text-lg font-semibold text-blue-500">Cr</span>
                  </div>
                  <div>
                    <p className="font-medium">Creatify API</p>
                    <p className="text-sm text-muted-foreground">
                      Generates short-form videos
                    </p>
                  </div>
                </div>
                <Badge
                  variant={settings.creatify.connected ? "default" : "secondary"}
                  className="gap-1"
                >
                  {settings.creatify.connected ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Connected
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3" />
                      Not configured
                    </>
                  )}
                </Badge>
              </div>

              <Separator />

              {/* Publer */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                      <span className="text-lg font-semibold text-green-500">P</span>
                    </div>
                    <div>
                      <p className="font-medium">Publer</p>
                      <p className="text-sm text-muted-foreground">
                        Schedules posts to social media
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={settings.publer.connected ? "default" : "secondary"}
                    className="gap-1"
                  >
                    {settings.publer.connected ? (
                      <>
                        <CheckCircle className="h-3 w-3" />
                        {settings.publer.accounts.length} account{settings.publer.accounts.length !== 1 ? "s" : ""}
                      </>
                    ) : settings.publer.configured ? (
                      <>
                        <XCircle className="h-3 w-3" />
                        No accounts found
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3" />
                        Not configured
                      </>
                    )}
                  </Badge>
                </div>

                {/* Show connected Publer accounts */}
                {settings.publer.accounts.length > 0 && (
                  <div className="ml-13 pl-[52px] space-y-2">
                    {settings.publer.accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center gap-3 rounded-lg bg-muted/50 p-2"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={account.avatar_url} />
                          <AvatarFallback
                            className={`${platformColors[account.platform || ""] || "bg-gray-500"} text-white text-xs`}
                          >
                            {(account.platform || "??").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
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
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500/10">
                    <Sparkles className="h-5 w-5 text-pink-500" />
                  </div>
                  <div>
                    <p className="font-medium">Brand Voice Guidelines</p>
                    <p className="text-sm text-muted-foreground">
                      Customize script generation with your brand voice
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Link>

              <Link
                href="/settings/auto-mode"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
                    <Zap className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="font-medium">Auto Mode Status</p>
                    <p className="text-sm text-muted-foreground">
                      Monitor automatic video generation and cron jobs
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Environment Setup</CardTitle>
              <CardDescription>
                Add your API keys to the environment variables to enable integrations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-muted p-4 font-mono text-sm space-y-1">
                <p className="text-muted-foreground"># .env.local</p>
                <p className={settings.llm.connected ? "text-green-500" : ""}>
                  {settings.llm.configEnvVar}={settings.llm.connected ? "✓ configured" : "..."}
                </p>
                <p className={settings.creatify.connected ? "text-green-500" : ""}>
                  CREATIFY_API_ID={settings.creatify.connected ? "✓ configured" : "..."}
                </p>
                <p className={settings.creatify.connected ? "text-green-500" : ""}>
                  CREATIFY_API_KEY={settings.creatify.connected ? "✓ configured" : "..."}
                </p>
                <p className={settings.publer.configured ? "text-green-500" : ""}>
                  PUBLER_API_KEY={settings.publer.configured ? "✓ configured" : "..."}
                </p>
                <p className={settings.publer.configured ? "text-green-500" : ""}>
                  PUBLER_WORKSPACE_ID={settings.publer.configured ? "✓ configured" : "..."}
                </p>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Get your API keys from the respective service dashboards:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Anthropic Console
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://creatify.ai/api"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Creatify
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://publer.com/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Publer API
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>

              <Separator className="my-4" />

              <div className="space-y-2">
                <p className="text-sm font-medium">Publer Setup Instructions:</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Go to Publer Settings → Access & Login → API Keys</li>
                  <li>Create a new API key with scopes: workspaces, accounts, posts</li>
                  <li>Copy the API key to PUBLER_API_KEY</li>
                  <li>Get your workspace ID from the Publer URL or API</li>
                  <li>Add PUBLER_WORKSPACE_ID to your .env.local</li>
                  <li>Restart the dev server to apply changes</li>
                </ol>
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
