// Runs the worker and the web app in one container, for hosts that run a single service per app
// (Railway, PikaPods, an Unraid template). docker compose runs them as two services instead.
//
// The worker starts first and applies migrations; the app starts once the worker's /health answers.
// If either process exits, the other is stopped too, so the host restarts the container.
import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const workerPort = process.env.WORKER_PORT || (port === "3001" ? "3002" : "3001");
const env = {
  ...process.env,
  PORT: port,
  WORKER_PORT: workerPort,
  APP_INTERNAL_URL: process.env.APP_INTERNAL_URL || `http://localhost:${port}`,
};

const children = new Set();
let stopping = false;

function run(name, command, args) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[start-all] ${name} exited (${signal ?? code}), stopping`);
    stop(code || 1);
  });
  return child;
}

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => process.exit(exitCode), 10_000);
  const check = setInterval(() => {
    if (children.size === 0) {
      clearInterval(check);
      clearTimeout(timer);
      process.exit(exitCode);
    }
  }, 100);
}

async function waitForWorker() {
  const url = `http://localhost:${workerPort}/health`;
  while (!stopping) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));

run("worker", "node_modules/.bin/tsx", ["--env-file-if-exists=.env", "src/worker/index.ts"]);
if (await waitForWorker()) {
  run("app", "node_modules/.bin/next", ["start"]);
}
