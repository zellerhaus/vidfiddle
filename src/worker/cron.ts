/**
 * Runs the app's cron routes on a schedule, replacing Vercel Cron for self-hosted installs.
 * Each job calls the same /api/cron/<job> route Vercel called, with the CRON_SECRET bearer token.
 */

export interface CronJob {
  name: string;
  /** Standard 5-field cron expression (minute hour day-of-month month day-of-week), local time. */
  schedule: string;
}

// The schedules from the original vercel.json. Override one with CRON_<NAME>, for example
// CRON_CHECK_FEEDS="0 */6 * * *", or set it to "off" to disable the job.
const DEFAULT_JOBS: CronJob[] = [
  { name: "check-feeds", schedule: "0 8 * * *" },
  { name: "process-queue", schedule: "0 9 * * *" },
  { name: "check-creatify", schedule: "*/2 * * * *" },
  { name: "verify-publer", schedule: "*/10 * * * *" },
];

export function configuredJobs(env: Record<string, string | undefined> = process.env): CronJob[] {
  return DEFAULT_JOBS.flatMap((job) => {
    const override = env[`CRON_${job.name.toUpperCase().replaceAll("-", "_")}`]?.trim();
    if (override === "off") return [];
    return [{ ...job, schedule: override || job.schedule }];
  });
}

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;

function fieldMatches(field: string, value: number, [min, max]: readonly [number, number]): boolean {
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    let [lo, hi] = [min, max];
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      [lo, hi] = [a, b ?? (stepText ? max : a)];
    }
    if ([lo, hi, step].some((n) => !Number.isInteger(n)) || step < 1) {
      throw new Error(`Invalid cron field "${field}"`);
    }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/** Whether a 5-field cron expression matches the given minute. */
export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron expression needs 5 fields: "${expression}"`);
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  return fields.every((field, i) => fieldMatches(field, values[i], RANGES[i]));
}

/**
 * Checks the schedule at the start of every minute. A job that is still running when its next
 * slot arrives is skipped rather than run twice.
 */
export function startCron(opts: { appUrl: string; secret: string; jobs?: CronJob[] }): () => void {
  const jobs = opts.jobs ?? configuredJobs();
  for (const job of jobs) cronMatches(job.schedule, new Date()); // fail fast on a bad expression
  const running = new Set<string>();

  const tick = () => {
    const now = new Date();
    for (const job of jobs) {
      if (!cronMatches(job.schedule, now) || running.has(job.name)) continue;
      running.add(job.name);
      fetch(`${opts.appUrl}/api/cron/${job.name}`, {
        headers: { Authorization: `Bearer ${opts.secret}` },
        signal: AbortSignal.timeout(15 * 60_000),
      })
        .then(async (res) => {
          if (!res.ok && res.status !== 503) {
            console.error(`[cron] ${job.name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
          }
        })
        .catch((error) => console.error(`[cron] ${job.name}: ${error instanceof Error ? error.message : error}`))
        .finally(() => running.delete(job.name));
    }
  };

  let timer: NodeJS.Timeout;
  const schedule = () => {
    timer = setTimeout(() => {
      tick();
      schedule();
    }, 60_000 - (Date.now() % 60_000) + 50);
  };
  schedule();
  console.log(`[cron] ${jobs.length ? jobs.map((j) => `${j.name} "${j.schedule}"`).join(", ") : "all jobs turned off"}`);
  return () => clearTimeout(timer);
}
