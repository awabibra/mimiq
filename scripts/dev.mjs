import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const python = join(root, "backend", "venv", "bin", "python");
const next = join(root, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(python)) {
  console.error(
    "Audio backend environment is missing. Run: python3 -m venv backend/venv && backend/venv/bin/pip install -r backend/requirements.txt"
  );
  process.exit(1);
}

const forwarded = process.argv.slice(2);
const webArgs = [];
for (let index = 0; index < forwarded.length; index += 1) {
  const argument = forwarded[index];
  if (argument === "--strictPort") continue;
  webArgs.push(argument === "--host" ? "--hostname" : argument);
}

const children = [
  spawn(process.execPath, [next, "dev", ...webArgs], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(
    python,
    ["-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: join(root, "backend"),
      stdio: "inherit",
    }
  ),
];

let stopping = false;
function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  const timer = setTimeout(() => process.exit(exitCode), 1200);
  timer.unref();
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    const failed = signal == null && code !== 0;
    stop("SIGTERM", failed ? code ?? 1 : 0);
  });
}

process.on("SIGINT", () => stop("SIGINT", 0));
process.on("SIGTERM", () => stop("SIGTERM", 0));
