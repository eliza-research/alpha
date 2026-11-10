import fs from "node:fs";
import path from "node:path";

export function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

export function cloudApi(root: string, environment: string): string | undefined {
  const deployments = readJson(path.join(root, "config/cloud-deployment.json"));
  const deployment = isRecord(deployments) ? deployments[environment] : undefined;
  return isRecord(deployment) && typeof deployment.api === "string" ? deployment.api : undefined;
}
