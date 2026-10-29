import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cron_logs } from "@/db/schema";
import type { CronType, CronExecutionStatus } from "@/lib/supabase/types";

export interface CronLogContext {
  logId: string;
  startedAt: Date;
  itemsProcessed: number;
  itemsFailed: number;
  errors: string[];
  summary: Record<string, unknown>;
}

export async function startCronLog(cronType: CronType): Promise<CronLogContext> {
  const startedAt = new Date();

  try {
    const [data] = await db
      .insert(cron_logs)
      .values({
        cron_type: cronType,
        started_at: startedAt.toISOString(),
        status: "success",
        items_processed: 0,
        items_failed: 0,
        errors: [],
        summary: {},
      })
      .returning({ id: cron_logs.id });

    if (!data) {
      throw new Error("Failed to create cron log");
    }

    return {
      logId: data.id,
      startedAt,
      itemsProcessed: 0,
      itemsFailed: 0,
      errors: [],
      summary: {},
    };
  } catch (error) {
    console.error("Failed to create cron log:", error);
    // Return a fallback context if logging fails
    return {
      logId: "fallback",
      startedAt,
      itemsProcessed: 0,
      itemsFailed: 0,
      errors: [],
      summary: {},
    };
  }
}

export async function completeCronLog(
  context: CronLogContext,
  status?: CronExecutionStatus
): Promise<void> {
  if (context.logId === "fallback") {
    return; // Skip update if logging failed initially
  }

  const completedAt = new Date();

  // Determine status based on results
  let finalStatus = status;
  if (!finalStatus) {
    if (context.itemsFailed > 0 && context.itemsProcessed === 0) {
      finalStatus = "error";
    } else if (context.itemsFailed > 0) {
      finalStatus = "partial";
    } else {
      finalStatus = "success";
    }
  }

  try {
    await db
      .update(cron_logs)
      .set({
        completed_at: completedAt.toISOString(),
        status: finalStatus,
        items_processed: context.itemsProcessed,
        items_failed: context.itemsFailed,
        errors: context.errors,
        summary: context.summary,
      })
      .where(eq(cron_logs.id, context.logId));
  } catch (error) {
    console.error("Failed to update cron log:", error);
  }
}

export function addError(context: CronLogContext, error: string): void {
  context.errors.push(error);
  context.itemsFailed++;
}

export function incrementProcessed(context: CronLogContext, count = 1): void {
  context.itemsProcessed += count;
}

export function setSummary(
  context: CronLogContext,
  key: string,
  value: unknown
): void {
  context.summary[key] = value;
}
