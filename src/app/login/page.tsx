"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { VidfiddleMark } from "@/components/brand";
import { LICENSE_NAME, LICENSE_URL, REPO_URL } from "@/lib/project";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await response.json();
        setError(data.error || "Invalid password");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center bg-pastel-blue p-6">
      <div className="w-full max-w-md">
        {/* Wordmark card, tilted like the launch video's title card */}
        <div className="relative mb-10 flex justify-center">
          <div className="-rotate-3 border-4 border-black bg-white px-7 py-4 shadow-hard">
            <h1 className="display text-5xl sm:text-6xl">Vidfiddle</h1>
          </div>
          <div className="star-burst absolute -top-6 right-6 size-14 bg-pastel-yellow sm:right-10" aria-hidden="true" />
        </div>

        <div className="border-4 border-black bg-white p-6 shadow-hard">
          <div className="mb-5 flex items-center gap-3">
            <VidfiddleMark className="size-9" />
            <p className="text-sm font-semibold leading-snug">
              Your blog already wrote your next 100 videos.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="label-chrome text-xs">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                required
              />
            </div>
            {error && (
              <p className="border-2 border-black bg-destructive px-3 py-2 text-sm font-semibold">{error}</p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>

        <p className="label-chrome mt-6 text-center text-[11px]">
          Vidfiddle is open source under the{" "}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-2 hover:bg-white">
            {LICENSE_NAME}
          </a>
          {" · "}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-2 hover:bg-white">
            View on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
