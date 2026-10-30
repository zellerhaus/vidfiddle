"use client";

import { PLATFORM_COLORS } from "@/lib/platform-colors";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Platform, ScheduledPost } from "@/lib/supabase/types";
import { CalendarEventComponent } from "./calendar-event";

export interface CalendarEvent {
  id: string;
  title: string;
  platform: Platform;
  date: Date;
  status: "scheduled" | "posted" | "pending" | "failed";
  scheduledPost?: ScheduledPost & { videos?: { blog_posts?: { title: string } } };
}

interface CalendarGridProps {
  events: CalendarEvent[];
  view: "month" | "week";
  onShowMoreClick?: (date: Date, events: CalendarEvent[]) => void;
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];


function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const days: (Date | null)[] = [];

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startDayOfWeek; i++) {
    days.push(null);
  }

  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  return days;
}

function getWeekDays(date: Date) {
  const day = date.getDay();
  const start = new Date(date);
  start.setDate(date.getDate() - day);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(date1: Date, date2: Date) {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

export function CalendarGrid({ events, view, onShowMoreClick }: CalendarGridProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const today = new Date();

  const handlePrevious = () => {
    if (view === "month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 7));
    }
  };

  const handleNext = () => {
    if (view === "month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 7));
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const getEventsForDay = (date: Date | null) => {
    if (!date) return [];
    return events.filter(event => isSameDay(event.date, date));
  };

  const days = view === "month"
    ? getMonthDays(currentDate.getFullYear(), currentDate.getMonth())
    : getWeekDays(currentDate);

  const weekDays = view === "week" ? getWeekDays(currentDate) : null;
  const weekStart = weekDays ? weekDays[0] : null;
  const weekEnd = weekDays ? weekDays[6] : null;

  const headerText = view === "month"
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : weekStart && weekEnd
      ? `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} - ${
          weekEnd.getMonth() !== weekStart.getMonth() ? MONTHS[weekEnd.getMonth()] + " " : ""
        }${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
      : "";

  return (
    <div className="flex flex-col h-full">
      {/* Navigation header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handlePrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-lg font-semibold">{headerText}</h2>
        <div className="w-[100px]" /> {/* Spacer for alignment */}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 border rounded-lg overflow-hidden">
        {/* Days of week header */}
        <div className="grid grid-cols-7 bg-muted border-b">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-sm font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className={cn(
          "grid grid-cols-7",
          view === "month" ? "auto-rows-[minmax(80px,1fr)]" : "auto-rows-[minmax(200px,1fr)]"
        )}>
          {days.map((day, index) => {
            const dayEvents = getEventsForDay(day);
            const isToday = day ? isSameDay(day, today) : false;
            const isCurrentMonth = day ? day.getMonth() === currentDate.getMonth() : false;

            return (
              <div
                key={index}
                className={cn(
                  "border-r border-b p-1 min-h-[80px]",
                  day === null && "bg-muted/50",
                  !isCurrentMonth && day && "bg-muted/30",
                  index % 7 === 6 && "border-r-0"
                )}
              >
                {day && (
                  <>
                    <div className={cn(
                      "flex items-center justify-center w-6 h-6 text-sm mb-1",
                      isToday && "bg-primary text-primary-foreground rounded-full font-medium"
                    )}>
                      {day.getDate()}
                    </div>
                    <div className="space-y-1 overflow-y-auto max-h-[calc(100%-28px)]">
                      {dayEvents.slice(0, view === "month" ? 3 : 10).map((event) => (
                        <CalendarEventComponent
                          key={event.id}
                          event={event}
                        />
                      ))}
                      {view === "month" && dayEvents.length > 3 && (
                        <button
                          onClick={() => onShowMoreClick?.(day, dayEvents)}
                          className="text-xs text-muted-foreground px-1.5 hover:text-foreground transition-colors"
                        >
                          +{dayEvents.length - 3} more
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Platform legend */}
      <div className="flex flex-wrap gap-2 mt-4 justify-center">
        {(Object.keys(PLATFORM_COLORS) as Platform[]).map((platform) => (
          <Badge
            key={platform}
            className={PLATFORM_COLORS[platform]}
          >
            {platform}
          </Badge>
        ))}
      </div>
    </div>
  );
}
