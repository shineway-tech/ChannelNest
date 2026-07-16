import net from "node:net";
import { spawn } from "node:child_process";

const children = [];
let stopping = false;

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    if (!child.killed) child.kill("SIGTERM");
  });
  process.exitCode = exitCode;
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (!stopping) stop(signal ? 1 : code || 0);
  });
}

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

if (!(await portIsOpen(3100))) {
  start(process.execPath, ["bin/www"], { cwd: "backend/channel_nest_api" });
}
start(process.execPath, ["bin/worker"], { cwd: "backend/channel_nest_api" });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
start(npm, ["--prefix", "frontend", "run", "dev"]);
