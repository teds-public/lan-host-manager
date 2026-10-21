import net from "node:net";

export async function isPortFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

export async function findFreePort(
  start: number,
  end: number,
  taken: Set<number>,
): Promise<number> {
  for (let p = start; p <= end; p++) {
    if (taken.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port in range ${start}-${end}`);
}
