import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPassword } from "../src/lib/auth";

test("verifyPassword accepts only the exact password", () => {
  process.env.APP_PASSWORD = "correct horse";
  assert.ok(verifyPassword("correct horse"));
  assert.ok(!verifyPassword("correct hors"));
  assert.ok(!verifyPassword("correct horse!"));
  assert.ok(!verifyPassword(""));
});

test("verifyPassword rejects everything when no password is configured", () => {
  delete process.env.APP_PASSWORD;
  assert.ok(!verifyPassword(""));
  assert.ok(!verifyPassword("anything"));
});
