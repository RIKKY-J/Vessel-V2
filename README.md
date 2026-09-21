# Vessel — In-Browser Cloud IDE & Sandbox Platform

Vessel is a modern, high-performance cloud development environment (IDE) built with **Next.js App Router**, **Docker**, **Prisma ORM**, **PostgreSQL**, and **AWS S3**. It empowers developers to spin up isolated containerized sandboxes on demand, edit code in Monaco Editor, execute commands via a low-latency bash terminal over WebSockets, and preview web applications live in the browser through a Next.js reverse proxy.

---

## 🚀 Key Features

* **🖥️ Native Interactive Terminal**: Real-time interactive bash terminal powered by `xterm.js` and `node-pty` over Socket.IO WebSockets.
* **⚡ Pre-Configured Runtimes**: Isolated Docker sandboxes pre-configured with Node.js 20 and Python 3 runtimes with automatic dependency resolution.
* **⚙️ Configurable Run Button**: Split Run control (`[ ▶ Run | ⚙ ]`) with a settings popover to configure project start commands (e.g. `node --watch index.js`, `npm run dev`, `python3 main.py`).
* **🌐 Transparent Live Web Preview**: Integrated browser viewport connected to user-run servers on port `3000` via Next.js Route Handler reverse proxy (`/api/preview/:id`) with auto-reload on file edits.
* **💻 Monaco Code Editor**: Full-featured code editor with syntax highlighting, multi-tab file explorer, and keyboard shortcuts (`Ctrl+Enter` to Run, `Ctrl+S` to Save).
* **🔒 Conventional Authentication**: Secure user management with `bcryptjs` password hashing, HTTP-only session cookies, and server-side authorization checks.
* **🐘 Relational Database & ORM (PostgreSQL + Prisma)**: Type-safe relational schema for `User`, `Project`, `ProjectSettings`, and `Sandbox`.
* **☁️ Ephemeral Compute & Persistent Storage**: Project files persist in AWS S3 (`code/{replId}/...`) as the source of truth, hydrated into ephemeral Docker volumes upon session start.
* **🎨 Modern Sleek Dark Theme**: Clean `#0B0D11` background, `#232936` borders, `#E73F1E` flame-red accents, and responsive layout controls.

---

## 🏗️ Architecture & Workflow

```
                        BROWSER
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
      Monaco           xterm.js           Preview
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │   NEXT.JS     │
                   │               │
                   │ App Router    │
                   │ Server Comp.  │
                   │ Client Comp.  │
                   │ Route Handler │
                   │ Service Layer │
                   └───────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
       ┌─────────┐    ┌─────────┐    ┌─────────┐
       │ Prisma  │    │   S3    │    │ Docker  │
       └────┬────┘    │  files  │    │ compute │
            │         └─────────┘    └────┬────┘
            ▼                             │
        PostgreSQL                        ▼
         metadata                  ┌─────────────┐
                                   │  Container  │
                                   │  app :3000  │
                                   │  pty :3001  │
                                   └─────────────┘
```

### Layered Separation of Concerns
* **Next.js App Router**: Owns the product — authentication, authorization, ownership verification, server-side data fetching, and reverse proxying.
* **Service Layer**: Decouples API Route Handlers from low-level infrastructure (`projectService`, `sandboxService`, `fileService`, `terminalService`).
* **Prisma & PostgreSQL**: Stores and manages relational metadata (`User`, `Project`, `ProjectSettings`, `Sandbox`).
* **AWS S3**: Source of truth for persistent project files.
* **Docker Engine**: Ephemeral execution layer with CPU, memory, and process limits.

---

## 📁 Repository Structure

```
Vessel-main/
├── frontend/                     # Next.js App Router Application
│   ├── prisma/
│   │   └── schema.prisma         # Prisma schema for PostgreSQL
│   ├── src/app/
│   │   ├── page.tsx              # Landing page
│   │   ├── signin/page.tsx       # Auth page (Email/Password login & signup)
│   │   ├── projects/
│   │   │   ├── page.tsx          # Server Component: dashboard with Prisma queries
│   │   │   ├── loading.tsx       # Staged loading state
│   │   │   ├── error.tsx         # Dashboard error boundary
│   │   │   └── [projectId]/      # Dynamic Project Workspace Route
│   │   │       ├── page.tsx      # Server Component: auth, ownership check, file preload
│   │   │       ├── loading.tsx   # Workspace loader skeleton
│   │   │       └── error.tsx     # Workspace error boundary
│   │   ├── coding/page.tsx       # Backwards-compatibility redirect to /projects/[projectId]
│   │   └── api/                  # Formal Route Handlers
│   │       ├── auth/             # Authentication & session endpoints
│   │       ├── projects/         # Project lifecycle & container management
│   │       │   └── [projectId]/  # Files, start, stop, run, sync, status handlers
│   │       └── preview/          # Web preview reverse proxy
│   │           └── [projectId]/  # Container port 3000 reverse proxy
│   ├── src/components/           # Organized Domain UI Components
│   │   ├── editor/               # Monaco Editor, File Explorer & File Tree models
│   │   ├── terminal/             # xterm.js terminal with Socket.IO bash connection
│   │   ├── preview/              # Live reverse proxy iframe preview
│   │   ├── workspace/            # Cloud IDE shell & configurable Run button
│   │   └── projects/             # Sandboxes list & creation dashboard
│   ├── src/lib/
│   │   ├── db/                   # Prisma client singleton & queries
│   │   ├── auth/                 # bcrypt & JWT session cookies
│   │   ├── s3/                   # AWS S3 client, projects, and templates
│   │   └── docker.ts             # Docker sandbox lifecycle & resource limits
│   └── src/services/             # Service layer
│       ├── project.service.ts
│       ├── sandbox.service.ts
│       ├── file.service.ts
│       └── terminal.service.ts
│
├── runner/                       # Sandbox Daemon (Runs inside Docker container)
│   ├── Dockerfile                # Runner image
│   ├── src/index.ts              # Express server (:3001)
│   ├── src/ws.ts                 # Socket.IO WebSocket handlers
│   ├── src/pty.ts                # node-pty pseudo-terminal wrapper for bash
│   ├── src/process.ts            # User application process manager (:3000)
│   ├── src/fs.ts                 # Container filesystem operations
│   └── src/aws.ts                # Container S3 synchronization
│
├── templates/                    # Starter project boilerplate
│   ├── node-js/                  # Node.js starter (index.js, package.json)
│   └── python/                   # Python starter (main.py)
│
├── infra/                        # Infrastructure Configuration
│   └── docker-compose.yml        # Local development: PostgreSQL + Next.js + Runner
│
└── scripts/                      # Setup & Verification Scripts
    ├── seed-s3.js                # Uploads starter templates to S3 bucket
    └── verify-sandbox.js         # Verifies Docker engine, PostgreSQL, and S3 config
```

---

## 🛠️ Getting Started

### 1. Environment Setup
Copy `.env.example` in `frontend/` to `.env.local`:
```bash
cp frontend/.env.example frontend/.env.local
```
Configure your PostgreSQL `DATABASE_URL`, session secret, and AWS S3 credentials.

### 2. Install Dependencies & Generate Prisma Client
```bash
cd frontend
npm install
npx prisma generate
```

### 3. Run Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔒 Security Hardening

Docker sandboxes execute arbitrary code and are isolated using defense-in-depth measures:
* **CPU Limits**: Restricts each sandbox to 1 CPU core (`NanoCpus: 1000000000`).
* **Memory Limits**: Restricts each sandbox to 512 MB RAM (`Memory: 536870912`).
* **PID Limits**: Limits processes to 100 to prevent fork bombs (`PidsLimit: 100`).
* **Socket Protection**: `/var/run/docker.sock` is **never** exposed to the user container.
* **Volume Isolation**: Sandboxes operate exclusively within dedicated `/workspace` volumes.
