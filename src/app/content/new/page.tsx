import { AppLayout, Header } from "@/components/layout";
import { AddUrlForm } from "@/components/content";

export default function NewContentPage() {
  return (
    <AppLayout>
      <Header
        title="Add Content"
        description="Add a blog post URL to convert into a video"
      />
      <div className="flex-1 overflow-auto p-12">
        <AddUrlForm />
      </div>
    </AppLayout>
  );
}
