import { z } from "zod";
import os from "node:os";
import path from "node:path";

export const envSchema = z.object({
  DATA_DIR: z.string().optional(),
  DASHBOARD_PORT: z.coerce.number().int().default(5000),
  BIND_HOST: z.string().default("0.0.0.0"),
  PORT_RANGE_START: z.coerce.number().int().default(4100),
  PORT_RANGE_END: z.coerce.number().int().default(4999),
});

export function defaultDataDir(): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Local", "LanHostManager");
  }
  return path.join(os.homedir(), ".local", "share", "lanhostmanager");
}

export function resolveDataDir(): string {
  return process.env.DATA_DIR?.trim() || defaultDataDir();
}
