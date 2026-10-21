import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

interface Project {
  id: string; name: string; type: string; status: string; port: number;
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
          <button onClick={viewLogs} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">Logs</button>
          <button onClick={remove} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Remove</button>
        </div>
      </div>
      {msg && <p className="mt-1 text-xs text-red-600">{msg}</p>}
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
        <h1 className="text-xl font-bold">LAN Host Manager</h1>
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
  return <Dashboard />;
}

createRoot(document.getElementById("root")!).render(<App />);
