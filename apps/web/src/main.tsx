import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

interface Project {
  id: string; name: string; type: string; status: string; port: number; version: number;
  serveDir: string | null; spaFallback: boolean; startCommand: string | null;
  installCommand: string | null; lanUrl: string;
  scripts?: Record<string, string>;
}

interface ProjectDetails extends Project {
  autoStart: boolean;
}

type Toast = { ok: boolean; text: string } | null;

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
  const hasBody = opts?.body !== undefined && opts.body !== null;
  const res = await fetch(url, { ...opts, headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...(opts?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Request failed (${res.status})`);
  return data as T;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const btn = "inline-flex min-h-[36px] items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const cardCls = "rounded-xl border border-slate-200 bg-white shadow-sm";
const labelCls = "block text-sm font-medium text-slate-700";

function ToastBar({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <p role="status" aria-live="polite" className={`rounded-lg px-3 py-2 text-sm font-medium ${toast.ok ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-red-50 text-red-800 ring-1 ring-red-200"}`}>
      {toast.text}
    </p>
  );
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-emerald-500",
  stopped: "bg-slate-400",
  crashed: "bg-red-500",
  unknown: "bg-amber-500",
  starting: "bg-sky-500",
};

const STATUS_STYLE: Record<string, string> = {
  running: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  stopped: "bg-slate-100 text-slate-700 ring-slate-200",
  crashed: "bg-red-100 text-red-800 ring-red-200",
  unknown: "bg-amber-100 text-amber-800 ring-amber-200",
  starting: "bg-sky-100 text-sky-800 ring-sky-200",
};

const TYPE_STYLE: Record<string, string> = {
  node: "bg-violet-100 text-violet-800 ring-violet-200",
  static: "bg-cyan-100 text-cyan-800 ring-cyan-200",
  files: "bg-slate-200 text-slate-700 ring-slate-300",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[status] ?? STATUS_STYLE.unknown}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.unknown}`} />
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TYPE_STYLE[type] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {type}
    </span>
  );
}

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setProjects(await api<Project[]>("/api/projects")); setError(""); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { projects, loading, error, refresh };
}

function ConfirmDialog({ title, body, confirmLabel, danger, busy, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button autoFocus onClick={onCancel} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} className={`${btn} text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" aria-label={label} title={label}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}
      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {done ? (
        <svg aria-hidden="true" className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l6.6-6.6a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
      ) : (
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M5 13V6a2 2 0 012-2h7" /></svg>
      )}
    </button>
  );
}

function ImportBox({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<Toast>(null);
  const [review, setReview] = useState<{ importId: string; detection: { type: string; serveDirCandidates: string[]; scripts?: Record<string, string> } } | null>(null);
  const [name, setName] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const dragCount = useRef(0);

  async function upload(f: File) {
    setBusy(true); setMsg(null); setFile(f);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/imports/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setReview(data);
      setName(f.name.replace(/\.(rar|zip)$/i, ""));
      const scripts = Object.keys(data.detection.scripts ?? {});
      if (scripts.includes("start")) setStartCommand("npm start");
      else if (scripts.length > 0) setStartCommand(`npm run ${scripts[0]}`);
      else setStartCommand("");
    } catch (e) { setReview(null); setMsg({ ok: false, text: (e as Error).message }); }
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
      setReview(null); setFile(null); setName(""); setStartCommand("");
      setMsg({ ok: true, text: "Project imported. Start it from the list when ready." }); onDone();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  const canConfirm = review !== null && name.trim().length > 0 && !busy;

  return (
    <section aria-labelledby="import-heading" className={`${cardCls} p-4 sm:p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="import-heading" className="text-base font-semibold text-slate-900">Import project</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">.rar / .zip</span>
      </div>
      <div
        role="button" tabIndex={0} aria-label="Drop an archive here, or press Enter to browse"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("import-file")?.click(); } }}
        onDrop={(e) => { e.preventDefault(); dragCount.current = 0; setDrag(false); const f = e.dataTransfer.files[0]; if (f && !busy) void upload(f); }}
        onDragEnter={(e) => { e.preventDefault(); dragCount.current += 1; setDrag(true); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={(e) => { e.preventDefault(); dragCount.current = Math.max(0, dragCount.current - 1); if (dragCount.current === 0) setDrag(false); }}
        onClick={() => document.getElementById("import-file")?.click()}
        className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${drag ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100"}`}
      >
        <svg aria-hidden="true" className={`h-8 w-8 ${drag ? "text-blue-600" : "text-slate-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>
        <p className="text-sm font-medium text-slate-700">{busy ? "Uploading and detecting…" : drag ? "Drop the archive to upload" : "Drop an archive here, or click to browse"}</p>
        <p className="text-xs text-slate-500">RAR or ZIP, archives are scanned before import</p>
        {busy && <div aria-hidden="true" className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-1/2 animate-pulse rounded-full bg-blue-600" /></div>}
        {file && !busy && (
          <p className="mt-1 max-w-full truncate text-xs text-slate-600" title={`${file.name} (${formatBytes(file.size)})`}>
            Selected: <span className="font-medium text-slate-800">{file.name}</span> · {formatBytes(file.size)}
          </p>
        )}
        <input id="import-file" type="file" accept=".rar,.zip" aria-label="Choose an archive file" className="hidden" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      </div>
      <div className="mt-2"><ToastBar toast={msg} /></div>
      {review && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">Detected type:</span>
            <TypeBadge type={review.detection.type} />
            <span className="text-sm text-emerald-700">Ready to review</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelCls}>Project name
                <input aria-label="Project name" className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-site" />
              </label>
              <label className={labelCls}>Start command
                <input aria-label="Start command" className={`${inputCls} mt-1 font-mono`} value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="npm start" />
              </label>
            </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!canConfirm} onClick={confirm} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
              {busy ? "Importing…" : "Confirm and import"}
            </button>
            <button type="button" disabled={busy} onClick={() => { setReview(null); setFile(null); }} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Discard</button>
            {!name.trim() && <span className="text-xs text-slate-500">Enter a name to enable import.</span>}
          </div>
        </div>
      )}
    </section>
  );
}

type ConfirmState = { title: string; body: string; label: string; danger?: boolean; run: () => Promise<void> } | null;

function ProjectCard({ p, refresh }: { p: Project; refresh: () => void }) {
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [logsBusy, setLogsBusy] = useState(false);
  const [msg, setMsg] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfg, setCfg] = useState({ name: p.name, serveDir: "", spaFallback: false, startCommand: "", installCommand: "", port: p.port, autoStart: false });
  const logRef = useRef<HTMLPreElement>(null);

  function say(ok: boolean, text: string) { setMsg({ ok, text }); }

  useEffect(() => {
    if (showLogs && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [showLogs, logs]);

  async function action(a: string) {
    setMsg(null); setBusy(true);
    try {
      await api(`/api/projects/${p.id}/${a}`, { method: "POST" });
      refresh();
    } catch (e) { say(false, (e as Error).message); }
    finally { setBusy(false); }
  }

  async function replace(f: File) {
    setMsg(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/projects/${p.id}/replace`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      say(true, `Files replaced (v${data.version}).`);
      refresh();
    } catch (e) { say(false, (e as Error).message); }
    finally { setBusy(false); }
  }

  async function loadDetails() {
    if (showConfig) { setShowConfig(false); return; }
    setCfgBusy(true);
    try {
      const d = await api<ProjectDetails>(`/api/projects/${p.id}`);
      setDetails(d);
      setCfg({
        name: d.name, serveDir: d.serveDir ?? "", spaFallback: d.spaFallback,
        startCommand: d.startCommand ?? "", installCommand: d.installCommand ?? "",
        port: d.port, autoStart: d.autoStart,
      });
      setShowConfig(true);
    } catch (e) { say(false, (e as Error).message); }
    finally { setCfgBusy(false); }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api(`/api/projects/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: cfg.name,
          serveDir: p.type === "static" ? (cfg.serveDir || undefined) : undefined,
          spaFallback: p.type === "static" ? cfg.spaFallback : undefined,
          startCommand: p.type === "node" ? (cfg.startCommand || null) : undefined,
          installCommand: p.type === "node" ? (cfg.installCommand || null) : undefined,
          port: Number(cfg.port) !== p.port ? Number(cfg.port) : undefined,
          autoStart: cfg.autoStart,
        }),
      });
      say(true, "Configuration saved.");
      refresh();
    } catch (e) { say(false, (e as Error).message); }
    finally { setBusy(false); }
  }

  async function install() {
    setMsg(null); setBusy(true);
    try {
      await api(`/api/projects/${p.id}/install`, { method: "POST" });
      say(true, "Install started — watch the logs.");
    } catch (e) { say(false, (e as Error).message); }
    finally { setBusy(false); }
  }

  async function viewLogs() {
    if (showLogs) { setShowLogs(false); return; }
    setLogsBusy(true);
    try {
      const d = await api<{ logs: string }>(`/api/projects/${p.id}/logs`);
      setLogs(d.logs); setShowLogs(true);
    } catch (e) { say(false, (e as Error).message); }
    finally { setLogsBusy(false); }
  }

  async function openFolder() {
    setMsg(null);
    try {
      const d = await api<{ ok: boolean; path: string }>(`/api/projects/${p.id}/open-folder`, { method: "POST" });
      say(true, `Opened ${d.path} in file manager.`);
    } catch (e) { say(false, (e as Error).message); }
  }

  const isRunning = p.status === "running";

  return (
    <article aria-label={`Project ${p.name}`} className={`${cardCls} p-4 transition-shadow hover:shadow sm:p-5`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <strong className="min-w-0 flex-1 basis-40 truncate text-base text-slate-900" title={p.name}>{p.name}</strong>
        <TypeBadge type={p.type} />
        <StatusBadge status={p.status} />
        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">:{p.port}</span>
      </div>

      {isRunning && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <a href={p.lanUrl} target="_blank" rel="noreferrer" title={p.lanUrl} className="min-w-0 flex-1 truncate font-mono text-xs text-blue-700 underline-offset-2 hover:underline">{p.lanUrl}</a>
          <CopyButton text={p.lanUrl} label={`Copy URL for ${p.name}`} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Primary actions for ${p.name}`}>
        <button type="button" onClick={() => action("start")} disabled={busy || isRunning} aria-label={`Start ${p.name}`} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Start</button>
        <button type="button" onClick={() => action("stop")} disabled={busy || !isRunning} aria-label={`Stop ${p.name}`} className={`${btn} bg-slate-600 text-white hover:bg-slate-700`}>Stop</button>
        <button type="button" onClick={() => action("restart")} disabled={busy} aria-label={`Restart ${p.name}`} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>Restart</button>
        {isRunning && <a href={p.lanUrl} target="_blank" rel="noreferrer" aria-label={`Open ${p.name} in a new tab`} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Open</a>}
        <label className={`${btn} cursor-pointer bg-violet-600 text-white hover:bg-violet-700`}>
          Update
          <input type="file" accept=".rar,.zip" aria-label={`Upload replacement archive for ${p.name}`} className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setConfirm({ title: `Update ${p.name}?`, body: `Replace all files with ${f.name}. No backup is kept.`, label: "Replace files", run: () => replace(f) }); }} />
        </label>
        <button type="button" onClick={openFolder} aria-label={`Open project folder for ${p.name}`} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Folder</button>
        <button type="button" onClick={viewLogs} disabled={logsBusy} aria-expanded={showLogs} aria-label={`${showLogs ? "Hide" : "View"} logs for ${p.name}`} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>{logsBusy ? "Loading…" : showLogs ? "Hide logs" : "Logs"}</button>
        <button type="button" onClick={loadDetails} disabled={cfgBusy} aria-expanded={showConfig} aria-label={`${showConfig ? "Hide" : "Show"} configuration for ${p.name}`} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>{cfgBusy ? "Loading…" : "Config"}</button>
        <button type="button" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore} aria-label={`More actions for ${p.name}`} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
          More
          <svg aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${showMore ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {showMore && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-red-50/60 p-2 ring-1 ring-red-100" role="group" aria-label={`Dangerous actions for ${p.name}`}>
          {p.type === "node" && <button type="button" onClick={() => setConfirm({ title: `Install dependencies for ${p.name}?`, body: "Runs the package manager inside the project directory. Check the install command in Config first.", label: "Install", run: install })} disabled={busy} className={`${btn} bg-cyan-700 text-white hover:bg-cyan-800`}>Install</button>}
          <button type="button" onClick={() => setConfirm({ title: `Remove ${p.name}?`, body: "Stop the project and unregister it. Managed files can optionally be deleted.", label: "Remove", danger: true, run: async () => { setMsg(null); await fetch(`/api/projects/${p.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ removeFiles: window.confirm("Also delete managed files?") }) }); refresh(); } })} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Remove</button>
        </div>
      )}

      <div className="mt-1"><ToastBar toast={msg} /></div>

      {showConfig && details && (
        <form onSubmit={saveConfig} aria-label={`Configuration for ${p.name}`} className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:p-4">
          <p className="text-xs text-slate-500">v{details.version} · {details.type}
            {details.scripts && Object.keys(details.scripts).length > 0 && <> · scripts: {Object.keys(details.scripts).join(", ")}</>}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className={labelCls}>Name
              <input aria-label="Project name" className={`${inputCls} mt-1`} value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
            </label>
            <label className={labelCls}>Port
              <input aria-label="Project port" type="number" className={`${inputCls} mt-1`} value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })} />
              <span className="mt-0.5 block text-xs font-normal text-slate-500">Stop the project first to change the port.</span>
            </label>
            {p.type === "static" && (
              <>
                <label className={labelCls}>Serve directory
                  <input aria-label="Serve directory" className={`${inputCls} mt-1 font-mono`} value={cfg.serveDir} onChange={(e) => setCfg({ ...cfg, serveDir: e.target.value })} placeholder="(project root)" />
                </label>
                <label className="flex min-h-[36px] items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={cfg.spaFallback} onChange={(e) => setCfg({ ...cfg, spaFallback: e.target.checked })} /> SPA fallback
                </label>
              </>
            )}
            {p.type === "node" && (
              <>
                <label className={labelCls}>Start command
                  <input aria-label="Start command" className={`${inputCls} mt-1 font-mono`} value={cfg.startCommand} onChange={(e) => setCfg({ ...cfg, startCommand: e.target.value })} placeholder="npm start" />
                </label>
                <label className={labelCls}>Install command
                  <input aria-label="Install command" className={`${inputCls} mt-1 font-mono`} value={cfg.installCommand} onChange={(e) => setCfg({ ...cfg, installCommand: e.target.value })} placeholder="npm install --no-audit --no-fund" />
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">Runs only when you press Install.</span>
                </label>
              </>
            )}
          </div>
          <label className="mt-3 flex min-h-[36px] items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={cfg.autoStart} onChange={(e) => setCfg({ ...cfg, autoStart: e.target.checked })} /> Auto-start on server boot
          </label>
          <div className="mt-2">
            <button type="submit" disabled={busy} className={`${btn} bg-slate-800 text-white hover:bg-slate-900`}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}

      {showLogs && (
        <div className="mt-3 overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-800">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5">
            <span className="text-xs font-medium text-slate-400">Logs</span>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label={`Copy logs for ${p.name}`} onClick={() => void navigator.clipboard?.writeText(logs)} className="rounded px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Copy</button>
              <button type="button" aria-label={`Close logs for ${p.name}`} onClick={() => setShowLogs(false)} className="rounded px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Close</button>
            </div>
          </div>
          <pre ref={logRef} tabIndex={0} aria-label={`Logs for ${p.name}`} className="max-h-72 overflow-auto p-3 font-mono text-xs leading-relaxed text-emerald-300">{logs || "(no logs)"}</pre>
        </div>
      )}

      {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.label} danger={confirm.danger} busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => { const run = confirm.run; setConfirm(null); setBusy(true); try { await run(); } catch (e) { say(false, (e as Error).message); } finally { setBusy(false); } }} />}
    </article>
  );
}

function Settings({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({ rarBinary: "", maxUploadMb: "500", maxEntries: "10000", maxDecompressedMb: "2048", extractTimeoutSec: "120", lanAccess: "true" });
  const [msg, setMsg] = useState<Toast>(null);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<{ lanIps: string[]; dashboardPort: number; bindHost: string; portRange: [number, number]; lanAccess: boolean; projectHost: string } | null>(null);
  useEffect(() => {
    api<Record<string, string>>("/api/settings").then((s) => setForm({
      rarBinary: s.rarBinary ?? "", maxUploadMb: s.maxUploadMb ?? "500",
      maxEntries: s.maxEntries ?? "10000", maxDecompressedMb: s.maxDecompressedMb ?? "2048",
      extractTimeoutSec: s.extractTimeoutSec ?? "120", lanAccess: s.lanAccess ?? "true",
    })).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
    api<{ lanIps: string[]; dashboardPort: number; bindHost: string; portRange: [number, number]; lanAccess: boolean; projectHost: string }>("/api/system/info").then(setInfo).catch(() => undefined);
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setSaving(true);
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...form, lanAccess: form.lanAccess }) }); setMsg({ ok: true, text: "Settings saved." }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setSaving(false); }
  }
  const lanOn = form.lanAccess === "true";
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-[36px] items-center text-sm font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">← Projects</button>
      <h1 className="text-xl font-bold text-slate-900">Settings</h1>
      <ToastBar toast={msg} />
      <section aria-labelledby="net-heading" className={`${cardCls} p-4 sm:p-5`}>
        <h2 id="net-heading" className="text-base font-semibold text-slate-900">Network</h2>
        <dl className="mt-3 overflow-hidden rounded-lg ring-1 ring-slate-200">
          {[
            ["Dashboard", info ? `:${info.dashboardPort} (bind ${info.bindHost})` : "—"],
            ["Project range", info ? info.portRange.join(" – ") : "—"],
            ["LAN IPs", info?.lanIps.join(", ") || "—"],
            ["Serving on", info?.projectHost ?? "—"],
          ].map(([k, v], i) => (
            <div key={k} className={`flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:gap-3 ${i % 2 === 0 ? "bg-slate-50" : "bg-white"}`}>
              <dt className="w-32 shrink-0 font-medium text-slate-700">{k}</dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-slate-600" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
        <label className="mt-3 flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <span className="text-sm font-medium text-slate-800">LAN access for hosted projects
            <span className="block text-xs font-normal text-slate-500">Off = loopback only. Takes effect when a project is (re)started.</span>
          </span>
          <button
            type="button" role="switch" aria-checked={lanOn} aria-label="LAN access for hosted projects"
            onClick={() => setForm({ ...form, lanAccess: lanOn ? "false" : "true" })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${lanOn ? "bg-emerald-600" : "bg-slate-300"}`}
          >
            <span aria-hidden="true" className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${lanOn ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </label>
      </section>
      <form onSubmit={save} aria-labelledby="archive-heading" className={`${cardCls} space-y-3 p-4 sm:p-5`}>
        <h2 id="archive-heading" className="text-base font-semibold text-slate-900">Archive extraction</h2>
        <label className={labelCls}>RAR utility path
          <input aria-label="RAR utility path" className={`${inputCls} mt-1 font-mono`} value={form.rarBinary} onChange={(e) => setForm({ ...form, rarBinary: e.target.value })} placeholder="C:\Program Files\WinRAR\Rar.exe" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([
            ["Max upload (MB)", "maxUploadMb"],
            ["Max entries", "maxEntries"],
            ["Max decompressed (MB)", "maxDecompressedMb"],
            ["Extract timeout (s)", "extractTimeoutSec"],
          ] as const).map(([label, key]) => (
            <label key={key} className={labelCls}>{label}
              <input aria-label={label} inputMode="numeric" className={`${inputCls} mt-1`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button type="submit" disabled={saving} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{saving ? "Saving…" : "Save settings"}</button>
      </form>
      <section aria-labelledby="fw-heading" className={`${cardCls} p-4 text-sm sm:p-5`}>
        <h2 id="fw-heading" className="text-base font-semibold text-slate-900">Windows Firewall</h2>
        <p className="mt-1 text-slate-600">Allow inbound TCP on the dashboard port and project range for <strong>private</strong> networks only:</p>
        <div className="mt-2 flex items-start gap-1.5">
          <pre className="min-w-0 flex-1 select-all overflow-auto rounded-lg bg-slate-950 p-2.5 font-mono text-xs text-emerald-300">New-NetFirewallRule -DisplayName "LAN Host Manager" -Direction Inbound -Action Allow -Protocol TCP -LocalPort {info?.dashboardPort ?? 3000},{info?.portRange.join("-") ?? "4100-4999"} -Profile Private</pre>
          <CopyButton text={`New-NetFirewallRule -DisplayName "LAN Host Manager" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${info?.dashboardPort ?? 3000},${info?.portRange.join("-") ?? "4100-4999"} -Profile Private`} label="Copy firewall command" />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Never open these ports on public networks. No router port forwarding — LAN only.</p>
      </section>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div aria-hidden="true" className={`${cardCls} animate-pulse p-4`}>
      <div className="h-5 w-1/3 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-2/3 rounded bg-slate-100" />
      <div className="mt-3 flex gap-2">
        <div className="h-8 w-16 rounded-md bg-slate-200" />
        <div className="h-8 w-16 rounded-md bg-slate-100" />
        <div className="h-8 w-20 rounded-md bg-slate-100" />
      </div>
    </div>
  );
}

function Dashboard() {
  const { projects, loading, error, refresh } = useProjects();
  const [info, setInfo] = useState<{ lanIps: string[]; dashboardPort: number }>({ lanIps: [], dashboardPort: 3000 });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState("projects");
  useEffect(() => {
    api<{ lanIps: string[]; dashboardPort: number }>("/api/system/info").then(setInfo).catch(() => undefined);
  }, []);
  useEffect(() => {
    const f = () => setPage(window.location.hash === "#/settings" ? "settings" : "projects");
    f();
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(q.toLowerCase()) && (status === "all" || p.status === status));
  const running = projects.filter((p) => p.status === "running").length;
  const crashed = projects.filter((p) => p.status === "crashed").length;
  if (page === "settings") return <Settings onBack={() => { window.location.hash = "#/"; }} />;
  const lanLabel = `${info.lanIps.join(", ") || "—"}:${info.dashboardPort}`;
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">LAN Host Manager</h1>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-600" title={lanLabel}>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium">{projects.length} projects</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{running} running</span>
              {crashed > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-500" />{crashed} crashed</span>}
              <span className="hidden max-w-full truncate font-mono text-slate-500 sm:inline" title={lanLabel}>LAN {lanLabel}</span>
            </p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh project list" className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            <svg aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M4 4v5h5M16 16v-5h-5M6.5 8a5.5 5.5 0 019.4-1.5M13.5 12a5.5 5.5 0 01-9.4 1.5" /></svg>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a href="#/settings" aria-label="Open settings" className={`${btn} bg-slate-900 text-white hover:bg-slate-700`}>Settings</a>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200">{error}</p>}
        <ImportBox onDone={refresh} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="search">Search projects</label>
          <input id="search" className="min-h-[36px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sr-only" htmlFor="status-filter">Filter by status</label>
          <select id="status-filter" aria-label="Filter by status" className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
            <option value="crashed">Crashed</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        {loading
          ? <div className="space-y-3" aria-label="Loading projects"><SkeletonCard /><SkeletonCard /></div>
          : filtered.length === 0
            ? (
              <div className={`${cardCls} p-8 text-center`}>
                <svg aria-hidden="true" className="mx-auto h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7H4a1 1 0 00-1 1v9a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                <p className="mt-2 font-medium text-slate-700">{projects.length === 0 ? "No projects yet" : "No matches"}</p>
                <p className="mt-1 text-sm text-slate-500">{projects.length === 0 ? "Import a .rar or .zip archive above to get started." : "Try a different search or status filter."}</p>
              </div>
            )
            : <div className="space-y-3">{filtered.map((p) => <ProjectCard key={p.id} p={p} refresh={refresh} />)}</div>}
      </main>
    </div>
  );
}

function App() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return <Dashboard />;
}

createRoot(document.getElementById("root")!).render(<App />);
