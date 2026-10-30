"use client";

import { useState, useEffect } from "react";
import { AppLayout, Header } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Star, Loader2 } from "lucide-react";
import type { BrandGuideline } from "@/lib/supabase/types";

interface BrandGuidelineForm {
  name: string;
  is_default: boolean;
  voice_description: string;
  target_audience: string;
  terminology: string[];
  tone_guidelines: string;
  content_restrictions: string;
  example_phrases: string[];
}

const emptyForm: BrandGuidelineForm = {
  name: "",
  is_default: false,
  voice_description: "",
  target_audience: "",
  terminology: [],
  tone_guidelines: "",
  content_restrictions: "",
  example_phrases: [],
};

export default function BrandGuidelinesPage() {
  const [guidelines, setGuidelines] = useState<BrandGuideline[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BrandGuidelineForm>(emptyForm);
  const [terminologyInput, setTerminologyInput] = useState("");
  const [phraseInput, setPhraseInput] = useState("");

  useEffect(() => {
    fetchGuidelines();
  }, []);

  async function fetchGuidelines() {
    try {
      const response = await fetch("/api/brand-guidelines");
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setGuidelines(data);
    } catch (error) {
      toast.error("Failed to load brand guidelines");
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setForm(emptyForm);
    setEditingId(null);
    setTerminologyInput("");
    setPhraseInput("");
    setDialogOpen(true);
  }

  function openEditDialog(guideline: BrandGuideline) {
    setForm({
      name: guideline.name,
      is_default: guideline.is_default,
      voice_description: guideline.voice_description || "",
      target_audience: guideline.target_audience || "",
      terminology: Array.isArray(guideline.terminology) ? guideline.terminology as string[] : [],
      tone_guidelines: guideline.tone_guidelines || "",
      content_restrictions: guideline.content_restrictions || "",
      example_phrases: Array.isArray(guideline.example_phrases) ? guideline.example_phrases as string[] : [],
    });
    setEditingId(guideline.id);
    setTerminologyInput("");
    setPhraseInput("");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        voice_description: form.voice_description || null,
        target_audience: form.target_audience || null,
        tone_guidelines: form.tone_guidelines || null,
        content_restrictions: form.content_restrictions || null,
      };

      const url = editingId
        ? `/api/brand-guidelines/${editingId}`
        : "/api/brand-guidelines";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save");
      }

      toast.success(editingId ? "Brand guideline updated" : "Brand guideline created");
      setDialogOpen(false);
      fetchGuidelines();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;

    try {
      const response = await fetch(`/api/brand-guidelines/${deleteId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete");

      toast.success("Brand guideline deleted");
      setDeleteDialogOpen(false);
      setDeleteId(null);
      fetchGuidelines();
    } catch (error) {
      toast.error("Failed to delete brand guideline");
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const response = await fetch(`/api/brand-guidelines/${id}/set-default`, {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to set default");

      toast.success("Default brand guideline updated");
      fetchGuidelines();
    } catch (error) {
      toast.error("Failed to set default");
    }
  }

  function addTerminology() {
    const term = terminologyInput.trim();
    if (term && !form.terminology.includes(term)) {
      setForm({ ...form, terminology: [...form.terminology, term] });
      setTerminologyInput("");
    }
  }

  function removeTerminology(term: string) {
    setForm({ ...form, terminology: form.terminology.filter((t) => t !== term) });
  }

  function addPhrase() {
    const phrase = phraseInput.trim();
    if (phrase && !form.example_phrases.includes(phrase)) {
      setForm({ ...form, example_phrases: [...form.example_phrases, phrase] });
      setPhraseInput("");
    }
  }

  function removePhrase(phrase: string) {
    setForm({ ...form, example_phrases: form.example_phrases.filter((p) => p !== phrase) });
  }

  return (
    <AppLayout>
      <Header
        title="Brand Voice Guidelines"
        description="Define brand voice guidelines to customize script generation"
      />
      <div className="flex-1 overflow-auto p-12">
        <div className="max-w-3xl space-y-8">
          <div className="flex justify-end">
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : guidelines.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Star className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">No brand guidelines yet</h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
                  Create brand voice guidelines to customize how your video scripts are generated.
                </p>
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first guideline
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {guidelines.map((guideline) => (
                <Card key={guideline.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{guideline.name}</CardTitle>
                          {guideline.is_default && (
                            <Badge variant="default" className="gap-1">
                              <Star className="h-3 w-3" />
                              Default
                            </Badge>
                          )}
                        </div>
                        {guideline.voice_description && (
                          <CardDescription className="line-clamp-2">
                            {guideline.voice_description}
                          </CardDescription>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!guideline.is_default && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetDefault(guideline.id)}
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(guideline)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDeleteId(guideline.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid gap-4 text-sm">
                      {guideline.target_audience && (
                        <div>
                          <p className="font-medium text-muted-foreground">Target Audience</p>
                          <p>{guideline.target_audience}</p>
                        </div>
                      )}
                      {guideline.tone_guidelines && (
                        <div>
                          <p className="font-medium text-muted-foreground">Tone</p>
                          <p className="line-clamp-2">{guideline.tone_guidelines}</p>
                        </div>
                      )}
                      {Array.isArray(guideline.terminology) && guideline.terminology.length > 0 && (
                        <div>
                          <p className="font-medium text-muted-foreground mb-1">Key Terminology</p>
                          <div className="flex flex-wrap gap-1">
                            {(guideline.terminology as string[]).slice(0, 6).map((term) => (
                              <Badge key={term} variant="secondary" className="text-xs">
                                {term}
                              </Badge>
                            ))}
                            {(guideline.terminology as string[]).length > 6 && (
                              <Badge variant="outline" className="text-xs">
                                +{(guideline.terminology as string[]).length - 6} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Form Dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? "Edit Brand Guideline" : "Create Brand Guideline"}
                </DialogTitle>
                <DialogDescription>
                  Define voice and style guidelines for script generation.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Corporate Professional"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="is_default"
                    checked={form.is_default}
                    onCheckedChange={(checked) => setForm({ ...form, is_default: !!checked })}
                  />
                  <Label htmlFor="is_default" className="font-normal">
                    Set as default guideline
                  </Label>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="voice_description">Voice Description</Label>
                  <Textarea
                    id="voice_description"
                    value={form.voice_description}
                    onChange={(e) => setForm({ ...form, voice_description: e.target.value })}
                    placeholder="Describe the brand personality and voice (e.g., friendly, authoritative, casual)"
                    rows={3}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="target_audience">Target Audience</Label>
                  <Input
                    id="target_audience"
                    value={form.target_audience}
                    onChange={(e) => setForm({ ...form, target_audience: e.target.value })}
                    placeholder="e.g., Tech-savvy professionals aged 25-45"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="tone_guidelines">Tone Guidelines</Label>
                  <Textarea
                    id="tone_guidelines"
                    value={form.tone_guidelines}
                    onChange={(e) => setForm({ ...form, tone_guidelines: e.target.value })}
                    placeholder="Guidelines for tone (e.g., always positive, avoid jargon, use active voice)"
                    rows={3}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="content_restrictions">Content Restrictions</Label>
                  <Textarea
                    id="content_restrictions"
                    value={form.content_restrictions}
                    onChange={(e) => setForm({ ...form, content_restrictions: e.target.value })}
                    placeholder="Topics or language to avoid (e.g., competitor mentions, political topics)"
                    rows={2}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Key Terminology</Label>
                  <div className="flex gap-2">
                    <Input
                      value={terminologyInput}
                      onChange={(e) => setTerminologyInput(e.target.value)}
                      placeholder="Add a term"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTerminology();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addTerminology}>
                      Add
                    </Button>
                  </div>
                  {form.terminology.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {form.terminology.map((term) => (
                        <Badge
                          key={term}
                          variant="secondary"
                          className="gap-1 cursor-pointer hover:bg-destructive/10"
                          onClick={() => removeTerminology(term)}
                        >
                          {term}
                          <span className="text-muted-foreground">×</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>Example Phrases</Label>
                  <div className="flex gap-2">
                    <Input
                      value={phraseInput}
                      onChange={(e) => setPhraseInput(e.target.value)}
                      placeholder="Add an example phrase"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPhrase();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addPhrase}>
                      Add
                    </Button>
                  </div>
                  {form.example_phrases.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {form.example_phrases.map((phrase) => (
                        <div
                          key={phrase}
                          className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                        >
                          <span className="italic">&ldquo;{phrase}&rdquo;</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => removePhrase(phrase)}
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingId ? "Save Changes" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this brand guideline?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. Videos that were generated using this
                  guideline will not be affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </AppLayout>
  );
}
