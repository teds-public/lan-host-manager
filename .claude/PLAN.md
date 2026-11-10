# Kế hoạch chuyển đổi LAN Host Manager sang Rust

## Tổng quan

Chuyển đổi toàn bộ repository từ TypeScript/Node.js sang Rust với:
- **Backend**: Axum web framework
- **Frontend**: Yew (Rust WASM) thay vì React
- **Database**: SQLx với SQLite
- **Build system**: Cargo workspace

## Kiến trúc hiện tại

### Monorepo TypeScript/Node.js
```
├── apps/
│   ├── server/          # Fastify API server (~570 lines)
│   └── web/            # React + Vite frontend (~674 lines)
├── packages/
│   ├── archive/        # RAR/ZIP extraction với security checks
│   ├── config/         # Environment variable schema
│   ├── database/       # Drizzle ORM + SQLite schema
│   ├── detector/       # Project type detection (static/node/files)
│   ├── hosting/        # HTTP static server + Node.js process manager
│   ├── ports/          # Port availability checking
│   └── process-manager/ # Child process spawning & logging
```

### Chức năng chính
1. **Upload & Extract**: Upload .rar/.zip archives, extract với security (path traversal, symlink, size limits)
2. **Project Detection**: Detect static HTML, Node.js projects, hoặc plain files
3. **Hosting**: Serve static files hoặc spawn Node.js processes
4. **Process Management**: Start/stop/restart projects, capture logs
5. **Database**: SQLite lưu projects, settings
6. **LAN Access**: Bind to 0.0.0.0, firewall rules cho private networks

## Kiến trúc mới (Rust)

### Cargo Workspace
```
├── Cargo.toml          # Workspace root
├── src/
│   ├── main.rs         # Binary entry point
│   ├── api/            # Axum routes
│   ├── models/         # Data types
│   ├── db/             # SQLx queries & migrations
│   └── lib.rs          # Library exports
├── crates/
│   ├── archive/        # Archive extraction (zip crate + unrar CLI)
│   ├── config/         # Config parsing (clap + env vars)
│   ├── detector/       # Project detection
│   ├── hosting/        # Static file server + process spawning
│   ├── ports/          # Port checking
│   └── process-manager/ # Process lifecycle
├── frontend/
│   ├── Cargo.toml      # Yew WASM app
│   ├── src/
│   │   ├── main.rs
│   │   ├── components/ # Yew components
│   │   └── api/        # HTTP client to backend
│   └── index.html
└── migrations/         # SQL migrations cho SQLx
```

## Thực thi từng bước

### Phase 1: Setup Rust workspace (1-2 giờ)

1. **Tạo Cargo workspace root**
   - `Cargo.toml` với workspace members
   - `.gitignore` cho Rust (target/, Cargo.lock)
   - `rust-toolchain.toml` với stable channel

2. **Cấu trúc thư mục**
   ```
   cargo new --bin . --name lan-host-manager
   cargo new --lib crates/archive
   cargo new --lib crates/config
   cargo new --lib crates/database
   cargo new --lib crates/detector
   cargo new --lib crates/hosting
   cargo new --lib crates/ports
   cargo new --lib crates/process-manager
   cargo new --bin frontend
   ```

3. **Dependencies cơ bản** (`Cargo.toml`)
   ```toml
   [workspace]
   members = [".", "crates/*", "frontend"]
   resolver = "2"

   [workspace.dependencies]
   tokio = { version = "1", features = ["full"] }
   axum = "0.7"
   sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio-native-tls", "migrate"] }
   serde = { version = "1", features = ["derive"] }
   tracing = "0.1"
   ```

### Phase 2: Database layer (1-2 giờ)

4. **Migrate Drizzle schema sang SQLx**
   - Tạo `migrations/001_init.sql` với schema từ `packages/database/src/schema.ts`
   - Tables: `projects`, `settings`
   - Rust structs với `#[derive(FromRow)]`

5. **Database module** (`src/db/`)
   - `mod.rs`: Connection pool setup
   - `models.rs`: Project, Settings structs
   - `queries.rs`: CRUD operations với SQLx macros

### Phase 3: Core crates (3-4 giờ)

6. **crates/config**
   - Parse env vars: DATA_DIR, DASHBOARD_PORT, BIND_HOST, PORT_RANGE
   - Default data dir: `%LOCALAPPDATA%\LanHostManager` (Windows), `~/.local/share/lanhostmanager` (Linux)
   - Sử dụng `std::env`, `dirs` crate

7. **crates/ports**
   - `async fn is_port_free(port: u16) -> Result<bool>`
   - `async fn find_free_port(start: u16, end: u16, taken: &HashSet<u16>) -> Result<u16>`
   - Dùng `tokio::net::TcpListener`

8. **crates/detector**
   - Enum `ProjectType { Static, Node, Files }`
   - `detect_project(root: &Path) -> DetectionResult`
   - Check `package.json`, `index.html`, build dirs

9. **crates/archive**
   - **Security-critical**: Path traversal, symlink prevention
   - ZIP: Dùng `zip` crate, validate entries, inflate với size limits
   - RAR: Spawn `unrar`/`Rar.exe` CLI, parse output, timeout
   - `extract_archive(path: &Path, staging: &Path, limits: ExtractLimits) -> Result<ExtractResult>`
   - Junk filtering: `__MACOSX`, `.DS_Store`, etc.

10. **crates/process-manager**
    - `struct ManagedProcess { id, child, log_file, exit_code }`
    - Global `Mutex<HashMap<String, ManagedProcess>>`
    - `spawn_managed(id, cmd, args, opts) -> Result<Pid>`
    - `stop_managed(id, timeout_ms)` - Windows: `taskkill /T /F`, Linux: SIGTERM → SIGKILL
    - Log capture: stdout/stderr → timestamped log files

11. **crates/hosting**
    - Static server: `axum::Router` với `ServeDir` middleware
    - Node spawning: Delegate to `process-manager`
    - `serve_static(id, dir, port, spa_fallback, host) -> Result<()>`
    - `start_node(id, cwd, start_command, port, host) -> Result<Pid>`

### Phase 4: Backend API (4-5 giờ)

12. **Axum routes** (`src/api/`)
    - `GET /api/health`
    - `GET /api/projects` - List all
    - `GET /api/projects/:id` - Detail
    - `POST /api/imports/upload` - Multipart upload
    - `POST /api/imports/:id/confirm` - Finalize import
    - `POST /api/projects/:id/start` - Start hosting
    - `POST /api/projects/:id/stop`
    - `POST /api/projects/:id/restart`
    - `POST /api/projects/:id/install` - Run npm install
    - `POST /api/projects/:id/replace` - Upload new archive
    - `PATCH /api/projects/:id` - Update config
    - `DELETE /api/projects/:id`
    - `GET /api/projects/:id/logs`
    - `GET /api/system/info`
    - `GET /api/settings`
    - `PUT /api/settings`

13. **State management**
    - `struct AppState { db_pool, staging_dir, projects_dir, logs_dir, pending_imports }`
    - Axum `State` extractor
    - Pending imports: `Arc<Mutex<HashMap<Uuid, PendingImport>>>`

14. **Middleware**
    - CORS headers
    - Rate limiting (300 req/min per IP)
    - Multipart form handling với size limits
    - Error handling & JSON responses

15. **Process reconciliation**
    - Tokio background task: `tokio::spawn(reconcile_loop())`
    - Every 30s: Check running processes, auto-start, crash detection
    - Cleanup stale staging dirs (>24h old)

16. **Graceful shutdown**
    - Signal handler (SIGINT/SIGTERM)
    - Stop all hosted projects
    - Close DB connections
    - `tokio::select!` với shutdown channel

### Phase 5: Frontend WASM (5-6 giờ)

17. **Yew app setup** (`frontend/`)
    - `trunk serve` cho dev, `trunk build --release` cho production
    - `index.html` template
    - Routing với `yew-router`

18. **Components cấu trúc** (`frontend/src/components/`)
    - `App` - Root component với router
    - `ProjectList` - Danh sách projects với status badges
    - `ProjectDetail` - Chi tiết project, actions (start/stop/restart)
    - `ProjectLogs` - Log viewer với tail support
    - `UploadForm` - Upload archive với progress
    - `ImportConfirm` - Confirm import với config options
    - `Settings` - System settings form
    - `SystemInfo` - LAN IPs, port range, paths

19. **API client** (`frontend/src/api/`)
    - HTTP client với `reqwest` (WASM target)
    - Typed structs cho request/response
    - Error handling

20. **Styling**
    - Port Tailwind config sang Yew (hoặc dùng inline styles/CSS)
    - Hoặc dùng `stylist` crate cho scoped CSS

### Phase 6: Integration & Testing (2-3 giờ)

21. **Build pipeline**
    - Backend: `cargo build --release`
    - Frontend: `trunk build --release` → `frontend/dist/`
    - Backend serve frontend: `axum::Router::nest_service("/", ServeDir::new("frontend/dist"))`
    - SPA fallback: Return `index.html` cho non-API routes

22. **Launcher script** (`start.bat` cho Windows)
    ```batch
    @echo off
    cargo build --release
    cd frontend && trunk build --release && cd ..
    target\release\lan-host-manager.exe
    ```

23. **Testing**
    - Unit tests cho mỗi crate
    - Integration tests cho API endpoints
    - Security tests: Path traversal, command injection prevention
    - Port binding tests

24. **Documentation**
    - Update README.md với Rust setup instructions
    - Cargo doc comments
    - API documentation

### Phase 7: Cleanup (30 phút)

25. **Xóa code TypeScript cũ**
    - Remove `apps/`, `packages/`
    - Remove `package.json`, `turbo.json`, `tsconfig.base.json`
    - Remove `node_modules/`, `package-lock.json`
    - Keep `.env.example`, `README.md`, `.gitignore` (update cho Rust)

26. **Cập nhật README**
    - Rust setup: `rustup`, `trunk` install
    - Build commands
    - Windows firewall rules (không đổi)

## Dependencies chính

### Backend
```toml
axum = "0.7"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio-native-tls", "migrate"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "fs"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
uuid = { version = "1", features = ["v4", "serde"] }
zip = "0.6"
dirs = "5"
```

### Frontend (WASM)
```toml
yew = { version = "0.21", features = ["csr"] }
yew-router = "0.18"
reqwest = { version = "0.11", features = ["json"] }
serde = { version = "1", features = ["derive"] }
wasm-bindgen = "0.2"
web-sys = "0.3"
gloo = "0.11"
```

## Trade-offs & Considerations

### Ưu điểm
- **Performance**: Rust nhanh hơn Node.js rất nhiều
- **Memory safety**: No null pointer, use after free
- **Type safety**: Compile-time guarantees
- **Binary size**: Single executable, không cần Node.js runtime
- **Security**: Compile-time checks cho command injection, path traversal

### Thách thức
- **Learning curve**: Yew khác biệt so với React
- **Ecosystem**: Một số thư viện TypeScript chưa có tương đương Rust
- **Build time**: Rust compile chậm hơn TypeScript
- **WASM size**: Yew app có thể lớn hơn React bundle (cần wasm-opt)

### Tương thích ngược
- Database schema không đổi → data cũ vẫn hoạt động
- API endpoints không đổi → Client code (nếu có) không break
- Firewall rules không đổi
- Data directory không đổi

## Ước tính thời gian

- **Total**: 16-20 giờ coding
- **Testing & debugging**: +4-6 giờ
- **Documentation**: +2 giờ
- **Grand total**: ~22-28 giờ

## Success Criteria

✅ Compile thành công cả backend và frontend
✅ Upload và extract .rar/.zip archives
✅ Detect project types (static/node/files)
✅ Start/stop/restart projects
✅ Log viewing
✅ Settings persistence
✅ Auto-start on boot
✅ Security: Path traversal, command injection prevented
✅ Windows + Linux support
✅ Graceful shutdown
✅ Frontend UI hoàn chỉnh với Yew

## Risks & Mitigations

**Risk**: Yew learning curve cao
**Mitigation**: Bắt đầu với component đơn giản, tham khảo Yew examples

**Risk**: RAR extraction trên Windows
**Mitigation**: Spawn CLI giống như code cũ, test với WinRAR/unrar

**Risk**: Process management cross-platform
**Mitigation**: Test cả Windows (taskkill) và Linux (signals)

**Risk**: WASM bundle size quá lớn
**Mitigation**: `wasm-opt -Oz`, code splitting nếu cần

## Next Steps

Sau khi approve plan:
1. Setup workspace structure
2. Implement từ database layer lên API
3. Implement frontend component by component
4. Integration testing
5. Documentation
6. Cleanup code cũ
