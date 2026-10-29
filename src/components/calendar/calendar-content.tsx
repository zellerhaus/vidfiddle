"use client";

import { useState } from "react";
import { CalendarGrid, CalendarEvent } from "./calendar-grid";
import { CalendarEventComponent } from "./calendar-event";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface CalendarContentProps {
  initialEvents: CalendarEvent[];
}

function formatDateHeader(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CalendarContent({ initialEvents }: CalendarContentProps) {
  const [view, setView] = useState<"month" | "week">("month");
  const [showMoreDate, setShowMoreDate] = useState<Date | null>(null);
  const [showMoreEvents, setShowMoreEvents] = useState<CalendarEvent[]>([]);

  const handleShowMore = (date: Date, events: CalendarEvent[]) => {
    setShowMoreDate(date);
    setShowMoreEvents(events);
  };

  const handleCloseDialog = () => {
    setShowMoreDate(null);
    setShowMoreEvents([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end mb-4">
        <Tabs value={view} onValueChange={(v) => setView(v as "month" | "week")}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <CalendarGrid
        events={initialEvents}
        view={view}
        onShowMoreClick={handleShowMore}
      />

      {/* Show more events dialog */}
      <Dialog open={!!showMoreDate} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Events</DialogTitle>
            <DialogDescription>
              {showMoreDate && formatDateHeader(showMoreDate)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {showMoreEvents.map((event) => (
              <CalendarEventComponent key={event.id} event={event} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
