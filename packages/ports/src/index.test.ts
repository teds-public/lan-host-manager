import { describe, expect, it } from "vitest";
import { isPortFree, findFreePort } from "./index.js";

describe("ports", () => {
  it("finds a free port", async () => {
    const p = await findFreePort(4400, 4499, new Set());
    expect(p).toBeGreaterThanOrEqual(4400);
    expect(p).toBeLessThanOrEqual(4499);
    expect(await isPortFree(p)).toBe(true);
  });

  it("skips taken ports", async () => {
    const p = await findFreePort(4400, 4499, new Set([4400, 4401]));
    expect(p).toBeGreaterThanOrEqual(4402);
  });

  it("throws when range exhausted", async () => {
    await expect(findFreePort(4400, 4400, new Set([4400]))).rejects.toThrow();
  });
});
