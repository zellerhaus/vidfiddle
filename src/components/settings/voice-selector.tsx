"use client";

import * as React from "react";
import { AlertCircle, Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OPENAI_VOICES } from "@/lib/local-engine";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Voice {
  id: string;
  name: string;
  language: string;
  gender: string;
}

interface VoiceSelectorProps {
  value?: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
  className?: string;
  source?: "creatify" | "local" | "elevenlabs";
}

export function VoiceSelector({
  value,
  onChange,
  disabled = false,
  className,
  source = "creatify",
}: VoiceSelectorProps) {
  const [voices, setVoices] = React.useState<Voice[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [languageFilter, setLanguageFilter] = React.useState<string>("all");
  const [genderFilter, setGenderFilter] = React.useState<string>("all");

  React.useEffect(() => {
    if (source === "local") {
      setVoices(
        OPENAI_VOICES.map((voice) => ({
          id: voice.value,
          name: voice.label,
          language: "OpenAI",
          gender: voice.description,
        }))
      );
      setIsLoading(false);
      setError(null);
      return;
    }

    async function fetchVoices() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(source === "elevenlabs" ? "/api/voices/elevenlabs" : "/api/creatify/voices");

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch voices");
        }

        const data = await response.json();
        setVoices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load voices");
      } finally {
        setIsLoading(false);
      }
    }

    fetchVoices();
  }, [source]);

  // Get unique languages for filter dropdown
  const languages = React.useMemo(() => {
    const uniqueLanguages = new Set(voices.map((v) => v.language || "Other"));
    return Array.from(uniqueLanguages).sort((a, b) => {
      // English first, then alphabetical
      if (a.toLowerCase().includes("english")) return -1;
      if (b.toLowerCase().includes("english")) return 1;
      return a.localeCompare(b);
    });
  }, [voices]);

  // Get unique genders for filter
  const genders = React.useMemo(() => {
    const uniqueGenders = new Set(voices.map((v) => v.gender || "Unknown"));
    return Array.from(uniqueGenders).sort();
  }, [voices]);

  // Filter voices based on search and filters
  const filteredVoices = React.useMemo(() => {
    return voices.filter((voice) => {
      // Search filter
      const matchesSearch =
        searchQuery === "" ||
        (voice.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (voice.language || "").toLowerCase().includes(searchQuery.toLowerCase());

      // Language filter
      const matchesLanguage =
        languageFilter === "all" ||
        (voice.language || "Other") === languageFilter;

      // Gender filter
      const matchesGender =
        genderFilter === "all" ||
        (voice.gender || "Unknown") === genderFilter;

      return matchesSearch && matchesLanguage && matchesGender;
    });
  }, [voices, searchQuery, languageFilter, genderFilter]);

  // Group filtered voices by language
  const groupedVoices = React.useMemo(() => {
    const grouped: Record<string, Voice[]> = {};
    for (const voice of filteredVoices) {
      const lang = voice.language || "Other";
      if (!grouped[lang]) {
        grouped[lang] = [];
      }
      grouped[lang].push(voice);
    }
    return Object.entries(grouped).sort(([a], [b]) => {
      if (a.toLowerCase().includes("english")) return -1;
      if (b.toLowerCase().includes("english")) return 1;
      return a.localeCompare(b);
    });
  }, [filteredVoices]);

  // Find selected voice details
  const selectedVoice = React.useMemo(() => {
    return voices.find((v) => v.id === value);
  }, [voices, value]);

  // Display text for selected voice
  const displayText = selectedVoice
    ? `${selectedVoice.name} (${selectedVoice.language} - ${selectedVoice.gender})`
    : source === "local"
      ? "Select an OpenAI voice..."
      : "Select a voice...";

  // Clear all filters
  function clearFilters() {
    setSearchQuery("");
    setLanguageFilter("all");
    setGenderFilter("all");
  }

  const hasActiveFilters =
    searchQuery !== "" || languageFilter !== "all" || genderFilter !== "all";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-full" />
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || voices.length === 0}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">{displayText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <div className="p-3 border-b space-y-3">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={source === "local" ? "Search OpenAI voices..." : "Search voices..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Filters row */}
          <div className="flex gap-2">
            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Languages</SelectItem>
                {languages.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {genders.map((gender) => (
                  <SelectItem key={gender} value={gender}>
                    {gender}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 px-2"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Results count */}
          <div className="text-xs text-muted-foreground">
            Showing {filteredVoices.length} of {voices.length} voices
          </div>
        </div>

        {/* Voice list */}
        <ScrollArea className="h-[300px]">
          {filteredVoices.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No voices match your search
            </div>
          ) : (
            <div className="p-1">
              {groupedVoices.map(([language, languageVoices]) => (
                <div key={language}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground sticky top-0 bg-popover">
                    {language}
                  </div>
                  {languageVoices.map((voice) => (
                    <button
                      key={voice.id}
                      onClick={() => {
                        onChange(voice.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer",
                        value === voice.id && "bg-accent"
                      )}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          value === voice.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="flex-1 text-left truncate">
                        {voice.name}
                      </span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {voice.gender}
                      </Badge>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
