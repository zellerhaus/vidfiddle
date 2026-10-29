"use client";

import * as React from "react";
import { AlertCircle, Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Avatar {
  id: string;
  name: string;
  thumbnail_url: string;
}

interface AvatarSelectorProps {
  value?: string;
  onChange: (avatarId: string) => void;
  disabled?: boolean;
  className?: string;
}

export function AvatarSelector({
  value,
  onChange,
  disabled = false,
  className,
}: AvatarSelectorProps) {
  const [avatars, setAvatars] = React.useState<Avatar[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    async function fetchAvatars() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch("/api/creatify/avatars");

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch avatars");
        }

        const data = await response.json();
        setAvatars(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load avatars");
      } finally {
        setIsLoading(false);
      }
    }

    fetchAvatars();
  }, []);

  const filteredAvatars = React.useMemo(() => {
    if (!searchQuery) return avatars;
    return avatars.filter((avatar) =>
      (avatar.name || "").toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [avatars, searchQuery]);

  const selectedAvatar = React.useMemo(() => {
    return avatars.find((a) => a.id === value);
  }, [avatars, value]);

  const displayText = selectedAvatar
    ? selectedAvatar.name
    : "Select an avatar...";

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
          disabled={disabled || avatars.length === 0}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="flex items-center gap-2 truncate">
            {selectedAvatar?.thumbnail_url && (
              <img
                src={selectedAvatar.thumbnail_url}
                alt={selectedAvatar.name}
                className="h-5 w-5 rounded-full object-cover"
              />
            )}
            {displayText}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <div className="p-3 border-b space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search avatars..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Showing {filteredAvatars.length} of {avatars.length} avatars
            </div>
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="h-6 px-2"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[300px]">
          {filteredAvatars.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No avatars match your search
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 p-2">
              {filteredAvatars.map((avatar) => (
                <button
                  key={avatar.id}
                  onClick={() => {
                    onChange(avatar.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-all cursor-pointer",
                    value === avatar.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {avatar.thumbnail_url ? (
                    <img
                      src={avatar.thumbnail_url}
                      alt={avatar.name}
                      className="h-16 w-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
                      No img
                    </div>
                  )}
                  <span className="text-xs text-center truncate w-full">
                    {avatar.name}
                  </span>
                  {value === avatar.id && (
                    <Check className="h-3 w-3 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
