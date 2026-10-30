import { Sidebar } from "./sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="dot-grid flex flex-1 flex-col overflow-hidden bg-background">{children}</main>
    </div>
  );
}
