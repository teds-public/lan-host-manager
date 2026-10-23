import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("unknown"),
  status: text("status").notNull().default("stopped"),
  port: integer("port").notNull().unique(),
  path: text("path").notNull(),
  serveDir: text("serve_dir"),
  spaFallback: integer("spa_fallback").notNull().default(0),
  startCommand: text("start_command"),
  installCommand: text("install_command"),
  scripts: text("scripts"),
  pid: integer("pid"),
  lastExitCode: integer("last_exit_code"),
  logFile: text("log_file"),
  version: integer("version").notNull().default(1),
  autoStart: integer("auto_start").notNull().default(0),
  archiveName: text("archive_name"),
  archiveSize: integer("archive_size"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
