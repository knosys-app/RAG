import { execFile } from "node:child_process";
import { arch, platform, totalmem } from "node:os";
import { promisify } from "node:util";

import type { SystemStatus } from "@knosys-rag/contracts";
import { evaluatePlatformSupport } from "@knosys-rag/core";
import { app } from "electron";

import { getOllamaStatus } from "./ollama.js";

const execFileAsync = promisify(execFile);

async function getMacosVersion(): Promise<string> {
  if (platform() !== "darwin") {
    return "not-macos";
  }

  try {
    const { stdout } = await execFileAsync("/usr/bin/sw_vers", [
      "-productVersion",
    ]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const facts = {
    architecture: arch(),
    macosVersion: await getMacosVersion(),
    memoryBytes: totalmem(),
    platform: platform(),
  };

  const [ollama] = await Promise.all([getOllamaStatus()]);

  return {
    appVersion: app.getVersion(),
    ...facts,
    ollama,
    support: evaluatePlatformSupport(facts),
  };
}
