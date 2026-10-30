import { ExternalLink } from "lucide-react";
import { AppLayout, Header } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VidfiddleMark } from "@/components/brand";
import { FONT_CREDITS, MUSIC_CREDITS, SOFTWARE_CREDITS, type Credit } from "@/lib/credits";
import { COPYRIGHT, ISSUES_URL, LICENSE_NAME, LICENSE_URL, REPO_URL } from "@/lib/project";
import pkg from "../../../../package.json";

function CreditList({ credits }: { credits: Credit[] }) {
  return (
    <ul className="divide-y-2 divide-black/10">
      {credits.map((credit) => (
        <li key={`${credit.name}-${credit.by ?? ""}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <a href={credit.url} target="_blank" rel="noreferrer" className="font-bold underline decoration-2 underline-offset-2 hover:bg-primary">
              {credit.name}
            </a>
            {credit.by && <span className="text-sm"> by {credit.by}</span>}
            {credit.note && <p className="text-xs text-muted-foreground">{credit.note}</p>}
          </div>
          {credit.licenseUrl ? (
            <a href={credit.licenseUrl} target="_blank" rel="noreferrer">
              <Badge variant="outline">{credit.license}</Badge>
            </a>
          ) : (
            <Badge variant="outline">{credit.license}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AboutPage() {
  return (
    <AppLayout>
      <Header title="About & credits" description="Version, license, and the work Vidfiddle is built on" />
      <div className="flex-1 overflow-auto p-12">
        <div className="max-w-2xl space-y-8">
          <Card className="bg-pastel-yellow">
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <VidfiddleMark className="size-10" />
                <div>
                  <p className="display text-3xl">Vidfiddle</p>
                  <p className="label-chrome text-xs">Version {pkg.version}</p>
                </div>
              </div>
              <p className="text-sm font-semibold">
                Open source under the {LICENSE_NAME}. {COPYRIGHT}. Self-hosted: your posts, keys and videos stay on
                your server.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={REPO_URL} target="_blank" rel="noreferrer">
                    Original repo on GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                    {LICENSE_NAME} <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={ISSUES_URL} target="_blank" rel="noreferrer">
                    Report an issue <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Starter music</CardTitle>
              <CardDescription>
                Released into the public domain (CC0), so videos need no credit line, though credit is appreciated.
                Tracks you add to music/ and music composed by ElevenLabs follow their own terms, and some ElevenLabs
                plans require crediting ElevenLabs when you publish.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreditList credits={MUSIC_CREDITS} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fonts</CardTitle>
              <CardDescription>All under the SIL Open Font License 1.1.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreditList credits={FONT_CREDITS} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Built with</CardTitle>
              <CardDescription>The open-source projects Vidfiddle runs on.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreditList credits={SOFTWARE_CREDITS} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
