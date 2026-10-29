import type { Word } from "./types";

export interface CaptionStyle {
  font: string;
  uppercase: boolean;
  /** ASS colours are &HAABBGGRR. */
  textColor: string;
  highlightColor: string;
  maxWordsPerLine: number;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: "Anton", // bundled in assets/fonts (SIL Open Font License)
  uppercase: true,
  textColor: "&H00FFFFFF",
  highlightColor: "&H0000E1FF", // warm yellow
  maxWordsPerLine: 3,
};

function timestamp(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const clean = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/** Groups words into short lines, breaking on pauses so a line never spans a breath. */
export function groupWords(words: Word[], maxWords: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  for (const w of words) {
    const prev = line.at(-1);
    if (line.length >= maxWords || (prev && w.start - prev.end > 0.35) || (line.length > 0 && w.end - line[0].start > 1.4)) {
      lines.push(line);
      line = [];
    }
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Builds an .ass subtitle file for one scene: short lines of big outlined text in the lower
 * middle of the frame, with the word being spoken highlighted.
 */
export function buildAss(words: Word[], size: { width: number; height: number }, style = DEFAULT_CAPTION_STYLE): string {
  const fontSize = Math.round(Math.min(size.width, size.height) * 0.15);
  const marginV = Math.round(size.height * (size.height > size.width ? 0.24 : 0.12));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${style.font},${fontSize},${style.textColor},${style.textColor},&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.round(fontSize * 0.06)},${Math.round(fontSize * 0.03)},2,60,60,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];
  const lines = groupWords(words, style.maxWordsPerLine);
  lines.forEach((line, n) => {
    // A line lingers briefly after its last word, but never past the start of the next line:
    // overlapping events make libass stack both lines on screen.
    const lineEnd = Math.min(line[line.length - 1].end + 0.15, lines[n + 1]?.[0].start ?? Infinity);
    const texts = line.map((w) => {
      const t = clean(w.word);
      return style.uppercase ? t.toUpperCase() : t;
    });
    line.forEach((w, i) => {
      // Hold each highlight until the next word starts so the line doesn't flicker between words.
      const end = i < line.length - 1 ? line[i + 1].start : lineEnd;
      const text = texts
        .map((t, j) => (j === i ? `{\\c${style.highlightColor}}${t}{\\c${style.textColor}}` : t))
        .join(" ");
      events.push(`Dialogue: 0,${timestamp(w.start)},${timestamp(end)},Caption,,0,0,0,,${text}`);
    });
  });
  return [...header, ...events, ""].join("\n");
}
