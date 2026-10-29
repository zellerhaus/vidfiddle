/**
 * Creatomate API client for rendering styled captions onto video clips.
 *
 * Uses Creatomate templates with auto-transcription and caption styling.
 * The template handles word-level transcription and visual styling —
 * we just provide the video source URL.
 */

import type { CaptionStylePreset } from "@/lib/supabase/types";

const CREATOMATE_API_URL = "https://api.creatomate.com/v1";

interface CreatomateRenderResponse {
  id: string;
  status: string;
  url?: string;
  error_message?: string;
}

interface CreatomateRenderStatus {
  id: string;
  status: "planned" | "rendering" | "succeeded" | "failed";
  url?: string;
  error_message?: string;
  progress?: number;
}

interface CreatomateElement {
  type?: string;
  name?: string;
  id?: string;
  source?: string;
  elements?: CreatomateElement[];
}

/**
 * Default caption style presets backed by Creatomate templates
 */
export const DEFAULT_CAPTION_PRESETS: CaptionStylePreset[] = [
  {
    id: "highlighted",
    name: "Highlighted",
    templateId: "f2230071-954f-474a-aa6d-29d793f31bfb",
    fontFamily: "Montserrat",
    fontSize: 80,
    fontWeight: "800",
    textColor: "#FFFFFF",
    activeWordColor: "#FFD700",
    strokeColor: "#000000",
    strokeWidth: 4,
    position: "center",
    animation: "pop",
    wordsPerGroup: 4,
  },
  {
    id: "blocks",
    name: "Blocks",
    templateId: "f2230071-954f-474a-aa6d-29d793f31bfb",
    fontFamily: "Inter",
    fontSize: 72,
    fontWeight: "700",
    textColor: "#00E5FF",
    activeWordColor: "#FF00E5",
    strokeColor: "#000000",
    strokeWidth: 3,
    position: "center",
    animation: "fade",
    wordsPerGroup: 3,
  },
  {
    id: "karaoke",
    name: "Karaoke",
    templateId: "f2230071-954f-474a-aa6d-29d793f31bfb",
    fontFamily: "Poppins",
    fontSize: 64,
    fontWeight: "600",
    textColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.5)",
    strokeWidth: 2,
    position: "bottom",
    animation: "fade",
    wordsPerGroup: 5,
  },
];

/**
 * Render a captioned clip using a Creatomate template.
 * The template handles auto-transcription and caption styling.
 * Returns the render ID for polling.
 */
export async function renderCaptionedClip(params: {
  videoUrl: string;
  style: CaptionStylePreset;
}): Promise<{ renderId: string }> {
  const apiKey = process.env.CREATOMATE_API_KEY;
  if (!apiKey) {
    throw new Error("CREATOMATE_API_KEY environment variable is not set");
  }

  const { videoUrl, style } = params;

  if (!style.templateId) {
    throw new Error(
      `Caption style "${style.name}" has no templateId configured`
    );
  }

  // Discover the video element name in the template
  const videoElementName = await findVideoElementName(
    style.templateId,
    apiKey
  );

  const payload = {
    template_id: style.templateId,
    modifications: {
      [`${videoElementName}.source`]: videoUrl,
    },
  };

  console.log(
    `[Creatomate] Rendering with template ${style.templateId}, style: ${style.name}, video element: ${videoElementName}`
  );

  const response = await fetch(`${CREATOMATE_API_URL}/renders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Creatomate API error (${response.status}): ${errorText}`
    );
  }

  const data: CreatomateRenderResponse[] = await response.json();

  if (!data[0]?.id) {
    throw new Error("No render ID returned from Creatomate");
  }

  console.log(`[Creatomate] Render started: ${data[0].id}`);

  return { renderId: data[0].id };
}

/**
 * Fetch a Creatomate template and find the video element name.
 * This lets us set the video source via modifications regardless
 * of what the element is named in the template.
 */
async function findVideoElementName(
  templateId: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(
    `${CREATOMATE_API_URL}/templates/${templateId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Creatomate template (${response.status}): ${errorText}`
    );
  }

  const template = await response.json();

  // Template source can be a JSON string or object
  const source =
    typeof template.source === "string"
      ? JSON.parse(template.source)
      : template.source;

  // Recursively search for the first video element
  const name = findElementByType(source.elements || [], "video");
  if (!name) {
    throw new Error(
      `No video element found in Creatomate template ${templateId}`
    );
  }

  return name;
}

/**
 * Recursively find an element by type and return its name
 */
function findElementByType(
  elements: CreatomateElement[],
  type: string
): string | null {
  for (const el of elements) {
    if (el.type === type) {
      return el.name || el.id || null;
    }
    if (el.elements) {
      const found = findElementByType(el.elements, type);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Poll Creatomate for render status
 */
export async function getRenderStatus(
  renderId: string
): Promise<CreatomateRenderStatus> {
  const apiKey = process.env.CREATOMATE_API_KEY;
  if (!apiKey) {
    throw new Error("CREATOMATE_API_KEY environment variable is not set");
  }

  const response = await fetch(`${CREATOMATE_API_URL}/renders/${renderId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Creatomate status check error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

/**
 * Check if render is complete (succeeded or failed)
 */
export function isRenderComplete(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

/**
 * Check if Creatomate is configured
 */
export function isCreatomateConfigured(): boolean {
  return !!process.env.CREATOMATE_API_KEY;
}
