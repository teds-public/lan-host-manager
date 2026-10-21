# LAN Host Manager

LAN-only local web hosting platform. Upload `.rar` archives of web projects from any device on your Wi-Fi, extract, assign ports, host, and manage them.

## Windows setup

1. Install Node.js 20+ and pnpm 9+ (`npm i -g pnpm`).
2. Install WinRAR (provides extraction) — or set `RAR_BINARY` to your `unrar.exe` path.
3. `pnpm install`
4. Copy `.env.example` to `.env`, set a strong `SESSION_SECRET`.
5. `pnpm build`, then `pnpm start` (or `pnpm dev` per app).
6. Open `http://<host-lan-ip>:3000` from any LAN device.
7. Create the admin account on first launch.

## Firewall (Windows)

Allow inbound TCP on the dashboard port (default 3000) and the project range (4100–4999) for **private** networks only:

```powershell
New-NetFirewallRule -DisplayName "LAN Host Manager" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000,4100-4999 -Profile Private
```

Never open these ports on public networks, and never configure router port forwarding — this app is LAN-only by design.

## Layout

- `apps/server` — Fastify API + hosting runtime (serves the built dashboard).
- `apps/web` — React dashboard (`/api` relative URL).
- `packages/*` — shared, config, database, archive, detector, ports, process-manager, hosting.
- App data (DB, projects, logs, backups) lives outside the repo in `%LOCALAPPDATA%\LanHostManager` (Windows) or `~/.local/share/lanhostmanager` (Linux); override with `DATA_DIR`.

## Scripts

- `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test` (turborepo)

## Security notes

- Uploaded archives and project code are untrusted. Extraction blocks path traversal, absolute paths, and symlinks, with entry-count, size, and timeout limits.
- Project commands run only after your explicit approval; dependencies are never installed automatically.
- Running untrusted code on your host can compromise the machine — host only code you trust.
