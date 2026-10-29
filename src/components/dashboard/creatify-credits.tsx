"use client";

import { useEffect, useState } from "react";
import { Coins, ExternalLink } from "lucide-react";

export function CreatifyCredits() {
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/creatify/credits")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setCredits(data.remaining_credits))
      .catch(() => setError(true));
  }, []);

  // Don't render while loading or if Creatify isn't configured
  if (credits === null && !error) return null;
  if (error) return null;

  const color =
    credits! > 100
      ? "text-green-500"
      : credits! > 10
        ? "text-yellow-500"
        : "text-red-500";

  const borderColor =
    credits! > 100
      ? "border-border"
      : credits! > 10
        ? "border-yellow-500/30"
        : "border-red-500/30";

  const bgColor =
    credits! <= 10
      ? "bg-red-500/5"
      : credits! <= 100
        ? "bg-yellow-500/5"
        : "bg-card";

  return (
    <div
      className={`flex items-center justify-between rounded-lg border ${borderColor} ${bgColor} p-4`}
    >
      <div className="flex items-center gap-3">
        <Coins className={`h-4 w-4 ${color}`} />
        <p className="text-sm text-muted-foreground">
          Creatify Credits:{" "}
          <span className={`font-medium ${color}`}>{credits}</span>{" "}
          remaining
        </p>
      </div>
      <a
        href="https://creatify.ai/api"
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        Dashboard
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
