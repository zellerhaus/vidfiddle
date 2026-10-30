import type { Platform } from "@/lib/supabase/types";

/** Pastel chip colors per platform (background + readable text), shared by calendar and settings. */
export const PLATFORM_COLORS: Record<Platform, string> = {
  instagram: "bg-pastel-pink text-black",
  tiktok: "bg-black text-white",
  youtube: "bg-destructive text-black",
  linkedin: "bg-pastel-blue text-black",
  twitter: "bg-white text-black",
  facebook: "bg-[#a6c8ff] text-black",
};
