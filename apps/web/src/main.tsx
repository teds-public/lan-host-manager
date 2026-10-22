import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

interface Project {
  id: string; name: string; type: string; status: string; port: number; version: number;
  serveDir: string | null; spaFallback: boolean; startCommand: string | null;
  scripts?: Record<string, string>;
}

interface ProjectDetails extends Project {
  autoStart: boolean;
}

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) } });
  if (res.status === 401) { window.location.hash = "#/login"; throw new Error("Login required"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Request failed (${res.status})`);
  return data as T;
}

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try { setProjects(await api<Project[]>("/api/projects")); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { projects, error, refresh };
}

function ImportBox({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [review, setReview] = useState<{ importId: string; detection: { type: string; serveDirCandidates: string[]; scripts?: Record<string, string> } } | null>(null);
  const [name, setName] = useState("");
  const [startCommand, setStartCommand] = useState("");

  async function upload(f: File) {
    setBusy(true); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/imports/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setReview(data);
      setName(f.name.replace(/\.rar$/i, ""));
      const scripts = Object.keys(data.detection.scripts ?? {});
      if (scripts.includes("start")) setStartCommand("npm start");
      else if (scripts.length > 0) setStartCommand(`npm run ${scripts[0]}`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!review) return;
    setBusy(true);
    try {
      await api(`/api/imports/${review.importId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ name, startCommand: startCommand || undefined }),
      });
      setReview(null); setMsg("Project imported. Start it from the list when ready."); onDone();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded border p-4">
      <h2 className="font-semibold">Import .rar project</h2>
      <input
        type="file" accept=".rar" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
        onDragOver={(e) => e.preventDefault()}
        className="mt-2 block w-full"
      />
      {busy && <p className="text-sm text-gray-500">Working…</p>}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {review && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">Detected type: <strong>{review.detection.type}</strong></p>
          {review.detection.type === "unknown" && <p className="text-sm text-red-600">Unsupported runtime — cannot be hosted.</p>}
          <label className="block text-sm">Name
            <input className="ml-2 border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {review.detection.scripts && (
            <label className="block text-sm">Start command
              <input className="ml-2 border px-2 py-1 w-64" value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="npm start" />
            </label>
          )}
          <button disabled={busy || review.detection.type === "unknown" || !name} onClick={confirm} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
            Confirm and import
          </button>
        </div>
      )}
    </section>
  );
}

function ProjectRow({ p, refresh }: { p: Project; refresh: () => void }) {
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [msg, setMsg] = useState("");
  const [backups, setBackups] = useState<{ id: string; version: number; createdAt: string }[]>([]);
  const [showBackups, setShowBackups] = useState(false);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [cfg, setCfg] = useState({ name: p.name, serveDir: "", spaFallback: false, startCommand: "", port: p.port, autoStart: false });
  async function loadDetails() {
    const d = await api<ProjectDetails>(`/api/projects/${p.id}`);
    setDetails(d);
    setCfg({
      name: d.name, serveDir: d.serveDir ?? "", spaFallback: d.spaFallback,
      startCommand: d.startCommand ?? "", port: d.port, autoStart: d.autoStart,
    });
    setShowConfig((s) => !s);
  }
  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      await api(`/api/projects/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: cfg.name,
          serveDir: p.type === "static" ? (cfg.serveDir || undefined) : undefined,
          spaFallback: p.type === "static" ? cfg.spaFallback : undefined,
          startCommand: p.type === "node" ? (cfg.startCommand || null) : undefined,
          port: Number(cfg.port) !== p.port ? Number(cfg.port) : undefined,
          autoStart: cfg.autoStart,
        }),
      });
      setMsg("Configuration saved.");
      refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function install() {
    if (!window.confirm(`Run dependency install for ${p.name}? This executes the package manager inside the project directory.`)) return;
    setBusy(true); setMsg("");
    try {
      await api(`/api/projects/${p.id}/install`, { method: "POST" });
      setMsg("Install started — watch the logs.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function action(a: string) {
    setMsg("");
    try {
      await api(`/api/projects/${p.id}/${a}`, { method: "POST" });
      refresh();
    } catch (e) { setMsg((e as Error).message); }
  }
  async function update(f: File) {
    if (!window.confirm(`Update ${p.name} from ${f.name}? A backup is taken first.`)) return;
    setBusy(true); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const up = await fetch(`/api/projects/${p.id}/updates/upload`, { method: "POST", body: fd });
      const ud = await up.json();
      if (!up.ok) throw new Error(ud.message);
      const res = await fetch(`/api/updates/${ud.updateId}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const rd = await res.json();
      if (!res.ok) throw new Error(rd.restored ? `${rd.message} (previous version restored)` : rd.message);
      setMsg(`Updated to v${rd.version}.`);
      refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function loadBackups() {
    const d = await api<{ id: string; version: number; createdAt: string }[]>(`/api/projects/${p.id}/backups`);
    setBackups(d); setShowBackups((s) => !s);
  }
  async function rollback(bid: string) {
    if (!window.confirm("Roll back to this backup? The current version is replaced.")) return;
    setBusy(true);
    try {
      await api(`/api/projects/${p.id}/rollback/${bid}`, { method: "POST" });
      refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function snapshot() {
    setBusy(true);
    try {
      await api(`/api/projects/${p.id}/backups`, { method: "POST" });
      setMsg("Backup created.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function viewLogs() {
    const d = await api<{ logs: string }>(`/api/projects/${p.id}/logs`);
    setLogs(d.logs); setShowLogs((s) => !s);
  }
  async function remove() {
    if (!window.confirm(`Remove ${p.name}?`)) return;
    const removeFiles = window.confirm("Also delete managed files?");
    await fetch(`/api/projects/${p.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeFiles }),
    });
    refresh();
  }
  return (
    <div className="rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{p.name}</strong>
        <span className="text-xs rounded bg-gray-100 px-2 py-0.5">{p.type}</span>
        <span className="text-xs rounded bg-gray-100 px-2 py-0.5">{p.status}</span>
        <span className="text-xs">:{p.port}</span>
        <div className="ml-auto flex gap-1">
          <button onClick={() => action("start")} className="rounded bg-green-600 px-2 py-1 text-xs text-white">Start</button>
          <button onClick={() => action("stop")} className="rounded bg-gray-600 px-2 py-1 text-xs text-white">Stop</button>
          <button onClick={() => action("restart")} className="rounded bg-yellow-600 px-2 py-1 text-xs text-white">Restart</button>
          <label className="cursor-pointer rounded bg-purple-600 px-2 py-1 text-xs text-white">
            Update
            <input type="file" accept=".rar" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void update(f); }} />
          </label>
          <button onClick={snapshot} disabled={busy} className="rounded bg-teal-600 px-2 py-1 text-xs text-white disabled:opacity-50">Backup</button>
          <button onClick={loadBackups} className="rounded bg-orange-600 px-2 py-1 text-xs text-white">Backups</button>
          <button onClick={loadDetails} className="rounded bg-slate-600 px-2 py-1 text-xs text-white">Config</button>
          {p.type === "node" && <button onClick={install} disabled={busy} className="rounded bg-cyan-700 px-2 py-1 text-xs text-white disabled:opacity-50">Install</button>}
          <button onClick={viewLogs} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">Logs</button>
          <button onClick={remove} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Remove</button>
        </div>
      </div>
      {msg && <p className="mt-1 text-xs text-red-600">{msg}</p>}
      {showConfig && details && (
        <form onSubmit={saveConfig} className="mt-2 space-y-2 rounded bg-gray-50 p-2 text-sm">
          <p className="text-xs text-gray-500">v{details.version} · {details.type}
            {details.scripts && Object.keys(details.scripts).length > 0 &&
              <> · scripts: {Object.keys(details.scripts).join(", ")}</>}
          </p>
          <label className="block">Name
            <input className="ml-2 border px-2 py-1" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
          </label>
          <label className="block">Port
            <input type="number" className="ml-2 border px-2 py-1 w-24" value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })} />
            <span className="ml-2 text-xs text-gray-500">Stop the project first to change the port.</span>
          </label>
          {p.type === "static" && (
            <>
              <label className="block">Serve directory
                <input className="ml-2 border px-2 py-1" value={cfg.serveDir} onChange={(e) => setCfg({ ...cfg, serveDir: e.target.value })} placeholder="(project root)" />
              </label>
              <label className="block">
                <input type="checkbox" checked={cfg.spaFallback} onChange={(e) => setCfg({ ...cfg, spaFallback: e.target.checked })} /> SPA fallback
              </label>
            </>
          )}
          {p.type === "node" && (
            <label className="block">Start command
              <input className="ml-2 border px-2 py-1 w-64" value={cfg.startCommand} onChange={(e) => setCfg({ ...cfg, startCommand: e.target.value })} placeholder="npm start" />
            </label>
          )}
          <label className="block">
            <input type="checkbox" checked={cfg.autoStart} onChange={(e) => setCfg({ ...cfg, autoStart: e.target.checked })} /> Auto-start on server boot
          </label>
          <button disabled={busy} className="rounded bg-slate-700 px-3 py-1 text-xs text-white disabled:opacity-50">Save</button>
        </form>
      )}
      {showBackups && (
        <div className="mt-2 space-y-1">
          {backups.length === 0 && <p className="text-xs text-gray-500">No backups.</p>}
          {backups.map((b) => (
            <div key={b.id} className="flex items-center gap-2 text-xs">
              <span>v{b.version} · {new Date(b.createdAt).toLocaleString()}</span>
              <button onClick={() => rollback(b.id)} disabled={busy} className="rounded bg-orange-600 px-2 py-0.5 text-white disabled:opacity-50">Roll back</button>
            </div>
          ))}
        </div>
      )}
      {showLogs && <pre className="mt-2 max-h-64 overflow-auto bg-black p-2 text-xs text-green-300">{logs || "(no logs)"}</pre>}
    </div>
  );
}

function Login() {
  const [u, setU] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const need = await api<{ setupNeeded: boolean }>("/api/auth/setup-needed");
      const url = need.setupNeeded ? "/api/auth/setup" : "/api/auth/login";
      await api(url, { method: "POST", body: JSON.stringify({ username: u, password: pw }) });
      window.location.hash = "#/";
      window.location.reload();
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-20 max-w-sm space-y-3 rounded border p-6">
      <h1 className="text-lg font-semibold">LAN Host Manager</h1>
      <input className="w-full border px-2 py-1" placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} />
      <input className="w-full border px-2 py-1" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <button className="w-full rounded bg-blue-600 py-1 text-white">Sign in / Set up</button>
    </form>
  );
}

function Settings() {
  const [form, setForm] = useState({ rarBinary: "", maxUploadMb: "500", maxEntries: "10000", maxDecompressedMb: "2048", extractTimeoutSec: "120" });
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState("");
  const [info, setInfo] = useState<{ lanIps: string[]; dashboardPort: number; bindHost: string; portRange: [number, number] } | null>(null);
  useEffect(() => {
    api<Record<string, string>>("/api/settings").then((s) => setForm({
      rarBinary: s.rarBinary ?? "", maxUploadMb: s.maxUploadMb ?? "500",
      maxEntries: s.maxEntries ?? "10000", maxDecompressedMb: s.maxDecompressedMb ?? "2048",
      extractTimeoutSec: s.extractTimeoutSec ?? "120",
    })).catch((e) => setMsg((e as Error).message));
    api<{ lanIps: string[]; dashboardPort: number; bindHost: string; portRange: [number, number] }>("/api/system/info").then(setInfo).catch(() => undefined);
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify(form) }); setMsg("Settings saved."); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(pw) });
      setPw({ current: "", next: "" }); setPwMsg("Password changed.");
    } catch (e) { setPwMsg((e as Error).message); }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <nav className="text-sm"><a className="text-blue-600" href="#/">← Projects</a></nav>
      <h1 className="text-xl font-bold">Settings</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <section className="rounded border p-4">
        <h2 className="font-semibold">Network</h2>
        <p className="mt-1 text-sm text-gray-600">
          Dashboard port: {info?.dashboardPort} · Bind: {info?.bindHost} · Project range: {info?.portRange.join("–")} ·
          LAN: {info?.lanIps.join(", ") || "—"}
        </p>
      </section>
      <form onSubmit={save} className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">Archive extraction</h2>
        <label className="block text-sm">RAR utility path
          <input className="ml-2 w-72 border px-2 py-1" value={form.rarBinary} onChange={(e) => setForm({ ...form, rarBinary: e.target.value })} placeholder="C:\Program Files\WinRAR\WinRAR.exe" />
        </label>
        <label className="block text-sm">Max upload (MB)
          <input className="ml-2 w-24 border px-2 py-1" value={form.maxUploadMb} onChange={(e) => setForm({ ...form, maxUploadMb: e.target.value })} />
        </label>
        <label className="block text-sm">Max entries
          <input className="ml-2 w-24 border px-2 py-1" value={form.maxEntries} onChange={(e) => setForm({ ...form, maxEntries: e.target.value })} />
        </label>
        <label className="block text-sm">Max decompressed (MB)
          <input className="ml-2 w-24 border px-2 py-1" value={form.maxDecompressedMb} onChange={(e) => setForm({ ...form, maxDecompressedMb: e.target.value })} />
        </label>
        <label className="block text-sm">Extract timeout (s)
          <input className="ml-2 w-24 border px-2 py-1" value={form.extractTimeoutSec} onChange={(e) => setForm({ ...form, extractTimeoutSec: e.target.value })} />
        </label>
        <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Save settings</button>
      </form>
      <form onSubmit={changePw} className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">Change password</h2>
        <input className="block w-full max-w-xs border px-2 py-1" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <input className="block w-full max-w-xs border px-2 py-1" type="password" placeholder="New password (min 12 chars)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        {pwMsg && <p className="text-sm text-red-600">{pwMsg}</p>}
        <button className="rounded bg-slate-700 px-3 py-1 text-sm text-white">Change password</button>
      </form>
      <section className="rounded border p-4 text-sm">
        <h2 className="font-semibold">Windows Firewall</h2>
        <p className="mt-1 text-gray-600">Allow inbound TCP on the dashboard port and project range for <strong>private</strong> networks only:</p>
        <pre className="mt-2 overflow-auto bg-black p-2 text-xs text-green-300">New-NetFirewallRule -DisplayName "LAN Host Manager" -Direction Inbound -Action Allow -Protocol TCP -LocalPort {info?.dashboardPort ?? 3000},{info?.portRange.join("-") ?? "4100-4999"} -Profile Private</pre>
        <p className="mt-1 text-gray-600">Never open these ports on public networks. Do not configure router port forwarding — this app is LAN-only by design.</p>
      </section>
    </div>
  );
}

function Dashboard() {
  const { projects, error, refresh } = useProjects();
  const [info, setInfo] = useState<{ lanIps: string[]; dashboardPort: number }>({ lanIps: [], dashboardPort: 3000 });
  const [q, setQ] = useState("");
  useEffect(() => {
    api<{ lanIps: string[]; dashboardPort: number }>("/api/system/info").then(setInfo).catch(() => undefined);
  }, []);
  const filtered = projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const running = projects.filter((p) => p.status === "running").length;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">LAN Host Manager</h1>
          <a className="text-sm text-blue-600" href="#/settings">Settings</a>
        </div>
        <p className="text-sm text-gray-600">
          {projects.length} projects, {running} running · LAN: {info.lanIps.join(", ") || "—"}:{info.dashboardPort}
        </p>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ImportBox onDone={refresh} />
      <input className="w-full border px-2 py-1" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtered.length === 0
        ? <p className="text-sm text-gray-500">No projects yet. Import a .rar archive above.</p>
        : <div className="space-y-2">{filtered.map((p) => <ProjectRow key={p.id} p={p} refresh={refresh} />)}</div>}
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const f = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  if (route === "#/login") return <Login />;
  if (route === "#/settings") return <Settings />;
  return <Dashboard />;
}

createRoot(document.getElementById("root")!).render(<App />);
