import { AppLayout, Header } from "@/components/layout";
import { YouTubeUrlForm } from "@/components/youtube";
import { DEFAULT_CAPTION_PRESETS } from "@/lib/creatomate";
import { isSubmagicConfigured } from "@/lib/submagic";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import type { CaptionStylePreset } from "@/lib/supabase/types";

async function getCaptionPresets(): Promise<CaptionStylePreset[]> {
  try {
    const [setting] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "caption_style_presets"))
      .limit(1);

    if (setting?.value) {
      return setting.value as unknown as CaptionStylePreset[];
    }
  } catch {
    // Fall through to defaults
  }

  return DEFAULT_CAPTION_PRESETS;
}

export default async function NewYouTubePage() {
  const useSubmagic = isSubmagicConfigured();
  const presets = useSubmagic ? [] : await getCaptionPresets();

  return (
    <AppLayout>
      <Header
        title="Add YouTube Video"
        description="Paste a YouTube URL to detect viral moments and create short clips"
      />
      <div className="flex-1 overflow-auto p-12">
        <YouTubeUrlForm captionPresets={presets} pipeline={useSubmagic ? "submagic" : "legacy"} />
      </div>
    </AppLayout>
  );
}
