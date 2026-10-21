import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const sessions = new Map<string, { username: string; createdAt: number }>();
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSession(username: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

export function getSession(token: string | undefined): { username: string } | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) { sessions.delete(token); return null; }
  return s;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}
