import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Rss, Link2, Settings } from "lucide-react";

export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Link href="/content/new">
          <Button variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" />
            Add Blog URL
          </Button>
        </Link>
        <Link href="/feeds">
          <Button variant="outline" className="w-full justify-start gap-2">
            <Rss className="h-4 w-4" />
            Manage Feeds
          </Button>
        </Link>
        <Link href="/settings">
          <Button variant="outline" className="w-full justify-start gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
