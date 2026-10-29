import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredJobs, cronMatches } from "../src/worker/cron";

const at = (iso: string) => new Date(iso); // local time, which is what cron uses

test("cronMatches handles the default schedules", () => {
  assert.ok(cronMatches("0 8 * * *", at("2026-10-29T08:00:00")));
  assert.ok(!cronMatches("0 8 * * *", at("2026-10-29T08:01:00")));
  assert.ok(cronMatches("*/2 * * * *", at("2026-10-29T13:44:00")));
  assert.ok(!cronMatches("*/2 * * * *", at("2026-10-29T13:45:00")));
  assert.ok(cronMatches("* * * * *", at("2026-10-29T13:45:00")));
});

test("cronMatches supports lists, ranges, stepped ranges and weekdays", () => {
  assert.ok(cronMatches("15,45 9-17 * * 1-5", at("2026-10-29T09:45:00"))); // Thursday
  assert.ok(!cronMatches("15,45 9-17 * * 1-5", at("2026-11-01T09:45:00"))); // Sunday
  assert.ok(cronMatches("0 6-18/6 * * *", at("2026-10-29T12:00:00")));
  assert.ok(!cronMatches("0 6-18/6 * * *", at("2026-10-29T13:00:00")));
  assert.ok(cronMatches("0 0 1 1 *", at("2027-01-01T00:00:00")));
});

test("cronMatches rejects malformed expressions", () => {
  assert.throws(() => cronMatches("* * * *", new Date()));
  assert.throws(() => cronMatches("*/0 * * * *", new Date()));
  assert.throws(() => cronMatches("x * * * *", new Date()));
});

test("configuredJobs applies overrides and lets jobs be turned off", () => {
  const jobs = configuredJobs({ CRON_CHECK_FEEDS: "0 */6 * * *", CRON_CHECK_CREATIFY: "off" });
  assert.equal(jobs.find((j) => j.name === "check-feeds")?.schedule, "0 */6 * * *");
  assert.ok(!jobs.some((j) => j.name === "check-creatify"));
  assert.equal(jobs.find((j) => j.name === "check-youtube")?.schedule, "* * * * *");
});
