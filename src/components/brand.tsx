import { cn } from "@/lib/utils";

/** The Vidfiddle mark: a yellow tile with a black play triangle (same drawing as app/icon.svg). */
export function VidfiddleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect x="1" y="1" width="30" height="30" fill="#f7cb46" stroke="#000" strokeWidth="2" />
      <path d="M12 9.5 23 16 12 22.5Z" fill="#000" />
    </svg>
  );
}

/** VIDFIDDLE set in the display face. */
export function VidfiddleWordmark({ className }: { className?: string }) {
  return <span className={cn("display text-xl", className)}>Vidfiddle</span>;
}
