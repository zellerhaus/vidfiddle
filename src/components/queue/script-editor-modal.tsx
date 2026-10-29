"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

interface ScriptEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (script: string) => Promise<void>;
  initialScript: string;
  videoTitle?: string;
}

export function ScriptEditorModal({
  open,
  onOpenChange,
  onSave,
  initialScript,
  videoTitle,
}: ScriptEditorModalProps) {
  const [script, setScript] = useState(initialScript);
  const [isSaving, setIsSaving] = useState(false);

  // Update script when initialScript changes or dialog opens
  useEffect(() => {
    if (open) {
      setScript(initialScript);
    }
  }, [open, initialScript]);

  const handleSave = async () => {
    if (!script.trim()) return;

    setIsSaving(true);
    try {
      await onSave(script);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setScript(initialScript);
    onOpenChange(false);
  };

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Script</DialogTitle>
          <DialogDescription>
            {videoTitle
              ? `Edit the script for "${videoTitle}".`
              : "Edit the video script."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="min-h-64 font-mono text-sm"
            placeholder="Enter your script..."
            disabled={isSaving}
          />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{wordCount} words</span>
            <span>~{estimatedDuration}s estimated duration</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!script.trim() || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Script"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
