"use client";

import { useState } from "react";
import Image from "next/image";
import { PenLine, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { STYLE_PRESETS, presetForPrompt } from "@/lib/style-presets";

interface StylePickerProps {
  /** The visual style prompt. Empty lets the planner choose. */
  value: string;
  onChange: (value: string) => void;
}

const card = (selected: boolean) =>
  cn(
    "flex flex-col items-start gap-2 border-2 border-black p-2 text-left transition-all",
    selected ? "bg-primary shadow-hard-sm" : "bg-white hover:bg-accent"
  );

/** Preset looks from the showcase reel, plus "let Vidfiddle choose" and custom text. */
export function StylePicker({ value, onChange }: StylePickerProps) {
  const preset = presetForPrompt(value);
  const [customOpen, setCustomOpen] = useState(!!value && !preset);
  const mode = preset ? preset.id : customOpen || value ? "custom" : "auto";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => {
            setCustomOpen(false);
            onChange("");
          }}
          className={card(mode === "auto")}
        >
          <div className="flex aspect-square w-full items-center justify-center border-2 border-black bg-pastel-blue">
            <Sparkles className="h-8 w-8" />
          </div>
          <p className="text-xs font-bold leading-tight">Let Vidfiddle choose</p>
        </button>
        {STYLE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.prompt}
            onClick={() => {
              setCustomOpen(false);
              onChange(p.prompt);
            }}
            className={card(mode === p.id)}
          >
            <Image
              src={`/styles/${p.id}.jpg`}
              alt=""
              width={256}
              height={256}
              className="aspect-square w-full border-2 border-black object-cover"
            />
            <p className="text-xs font-bold leading-tight">{p.label}</p>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustomOpen(true);
            if (preset) onChange("");
          }}
          className={card(mode === "custom")}
        >
          <div className="flex aspect-square w-full items-center justify-center border-2 border-black bg-pastel-cream">
            <PenLine className="h-8 w-8" />
          </div>
          <p className="text-xs font-bold leading-tight">Custom</p>
        </button>
      </div>
      {mode === "custom" && (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Describe a look, e.g. ukiyo-e woodblock print, indigo and vermilion"
          autoFocus={!value}
        />
      )}
    </div>
  );
}
