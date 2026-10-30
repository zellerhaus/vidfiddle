/** Third-party work that ships with or powers Vidfiddle, shown on Settings → About & credits. */

export interface Credit {
  name: string;
  by?: string;
  license: string;
  licenseUrl?: string;
  url: string;
  /** What it's used for, or (for music) the mood it's filed under. */
  note?: string;
}

const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";
const OFL = "https://openfontlicense.org/";

/** The starter pack in assets/music (keep in step with assets/music/README.md). */
export const MUSIC_CREDITS: Credit[] = [
  { note: "Upbeat", name: "Feeling Human Again", by: "HoliznaCC0", license: "CC0 1.0", licenseUrl: CC0, url: "https://freemusicarchive.org/music/holiznacc0/spring-woke-me-up" },
  { note: "Calm", name: "Roof Tops", by: "HoliznaCC0", license: "CC0 1.0", licenseUrl: CC0, url: "https://freemusicarchive.org/music/holiznacc0/summer-air-lo-fi" },
  { note: "Inspiring", name: "Spring On The Horizon", by: "HoliznaCC0", license: "CC0 1.0", licenseUrl: CC0, url: "https://freemusicarchive.org/music/holiznacc0/background-music" },
  { note: "Dramatic", name: "Determined Pursuit (epic orchestra loop)", by: "Emma_MA", license: "CC0 1.0", licenseUrl: CC0, url: "https://opengameart.org/content/determined-pursuit-epic-orchestra-loop" },
  { note: "Playful", name: "A Small Town On Pluto (Music Box)", by: "HoliznaCC0", license: "CC0 1.0", licenseUrl: CC0, url: "https://freemusicarchive.org/music/holiznacc0/background-music" },
];

export const FONT_CREDITS: Credit[] = [
  { name: "Inter", by: "Rasmus Andersson", license: "OFL 1.1", licenseUrl: OFL, url: "https://rsms.me/inter/", note: "Interface and headings" },
  { name: "Space Grotesk", by: "Florian Karsten", license: "OFL 1.1", licenseUrl: OFL, url: "https://fonts.google.com/specimen/Space+Grotesk", note: "Labels" },
  { name: "IBM Plex Mono", by: "IBM", license: "OFL 1.1", licenseUrl: OFL, url: "https://www.ibm.com/plex/", note: "Scripts and code" },
  { name: "Anton", by: "Vernon Adams", license: "OFL 1.1", licenseUrl: OFL, url: "https://fonts.google.com/specimen/Anton", note: "Burned-in video captions (assets/fonts)" },
];

export const SOFTWARE_CREDITS: Credit[] = [
  { name: "Next.js", license: "MIT", url: "https://nextjs.org" },
  { name: "Drizzle ORM", license: "Apache-2.0", url: "https://orm.drizzle.team" },
  { name: "PostgreSQL", license: "PostgreSQL License", url: "https://www.postgresql.org" },
  { name: "Tailwind CSS", license: "MIT", url: "https://tailwindcss.com" },
  { name: "shadcn/ui and Radix UI", license: "MIT", url: "https://ui.shadcn.com" },
  { name: "Lucide icons", license: "ISC", url: "https://lucide.dev" },
  { name: "FFmpeg", license: "LGPL/GPL", url: "https://ffmpeg.org", note: "Rendering, run as a separate program" },
  { name: "LightPost", license: "MIT", url: "https://github.com/brainstormity/LightPost", note: "Self-hosted publishing" },
];
