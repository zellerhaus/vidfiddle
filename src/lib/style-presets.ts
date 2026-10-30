/**
 * Visual style presets for the local engine: the looks from the showcase reel. A preset is just
 * its prompt, stored in `visualStyle`, so custom text and presets work the same way downstream.
 * Thumbnails are scenes from the showcase renders (public/styles).
 */
export interface StylePreset {
  id: string;
  label: string;
  prompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: "felt-diorama", label: "Felt diorama", prompt: "handmade stop-motion felt diorama, soft studio lighting, playful" },
  { id: "watercolor", label: "Watercolor", prompt: "loose watercolor illustration on textured paper, soft natural colors" },
  { id: "clay", label: "3D clay", prompt: "glossy 3D clay render, miniature diorama, soft shadows" },
  { id: "deep-space", label: "Deep space", prompt: "deep-space astrophotography, rich teal and amber nebula colors" },
  { id: "paper-cut", label: "Paper-cut collage", prompt: "layered paper-cut collage, warm colors, visible paper texture" },
  { id: "sci-fi-paperback", label: "Sci-fi paperback", prompt: "1970s sci-fi paperback cover illustration, bold gouache colors, film grain" },
  { id: "flat-vector", label: "Flat vector", prompt: "bold flat vector illustration, limited palette of navy, orange and white" },
  { id: "photoreal", label: "Photoreal", prompt: "cinematic photorealistic, dramatic rim light, shallow depth of field" },
];

export function presetForPrompt(prompt: string | null | undefined): StylePreset | undefined {
  const normalized = (prompt ?? "").trim().toLowerCase();
  return STYLE_PRESETS.find((p) => p.prompt.toLowerCase() === normalized);
}
