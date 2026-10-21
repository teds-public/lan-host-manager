import { z } from "zod";

export const projectTypeSchema = z.enum(["static", "node", "unknown"]);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const projectStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "crashed",
  "unknown",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  type: projectTypeSchema,
  status: projectStatusSchema,
  port: z.number().int().min(1).max(65535),
  path: z.string().min(1),
  serveDir: z.string().optional(),
  spaFallback: z.boolean().default(false),
  startCommand: z.string().optional(),
  installCommand: z.string().optional(),
  pid: z.number().int().positive().nullable(),
  lastExitCode: z.number().int().nullable(),
  logFile: z.string().nullable(),
  version: z.number().int().default(1),
  autoStart: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  type: projectTypeSchema,
  port: z.number().int().min(1).max(65535).optional(),
  serveDir: z.string().optional(),
  spaFallback: z.boolean().default(false),
  startCommand: z.string().max(500).optional(),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const settingsSchema = z.object({
  dashboardPort: z.number().int().min(1).max(65535).default(3000),
  bindHost: z.string().default("0.0.0.0"),
  lanAccess: z.boolean().default(true),
  portRangeStart: z.number().int().min(1024).max(65535).default(4100),
  portRangeEnd: z.number().int().min(1024).max(65535).default(4999),
  maxUploadMb: z.number().int().min(1).max(4096).default(500),
  maxEntries: z.number().int().default(10000),
  maxDecompressedMb: z.number().int().default(2048),
  extractTimeoutSec: z.number().int().default(120),
  rarBinary: z.string().default(""),
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
