# Vessel — In-Browser Cloud IDE & Sandbox Platform

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Docker-Sandboxes-blue?style=for-the-badge&logo=docker" alt="Docker" />
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-Prisma-336791?style=for-the-badge&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/AWS-S3_Storage-orange?style=for-the-badge&logo=amazons3" alt="AWS S3" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

Vessel is a high-performance, in-browser cloud development platform inspired by Replit and CodeSandbox. It allows developers to spin up isolated containerized sandboxes on demand, write code in a full-featured Monaco editor, execute commands in an interactive bash terminal over WebSockets, and preview web applications live with hot-reload through a unified reverse proxy.

---

## 🚀 Key Features

* **⚡ On-Demand Docker Sandboxes**: Isolated, resource-constrained container environments (1 CPU core, 512MB RAM, 100 PIDs) pre-configured with Node.js 20 and Python 3.
* **🌐 Unified Single-Port Architecture**: All traffic (Next.js SSR/client app, REST APIs, live iframe preview reverse proxy, and interactive WebSocket PTY terminal) routes cleanly through **Port 3000** with zero secondary port exposure.
* **🖥️ Low-Latency Bash Terminal**: Real-time interactive bash shell powered by `xterm.js`, `node-pty`, and Socket.IO. Features dynamic resizing (`fitAddon`), session persistence across layout mode toggles, and zero-lag tab switching.
* **🔄 Live Web Preview with Hot-Reload**: Embedded browser viewport connected to container servers on port 3000 via a Next.js reverse proxy (`/api/preview/:id`). Express servers run with native `node --watch index.js` so code modifications automatically refresh the preview with cache-busting.
* **💻 Monaco Code Editor**: Visual Studio Code editing experience with syntax highlighting for JavaScript, TypeScript, Python, JSON, HTML, CSS, Markdown, and shell scripts. Includes keyboard shortcuts (`Ctrl+Enter` to run, `Ctrl+S` to save).
* **🤝 Live Multi-Client Synchronization**: 
  - **Debounced Auto-Save (800ms)**: File edits automatically persist to the container's `/workspace` volume.
  - **Real-Time WebSocket Sync**: Changes broadcast live (`fileUpdated`) across connected browser tabs.
  - **Tactile Refresh Files Button**: Smooth click press effect (`scale-90` + `rotate-180`), spinning loader feedback, and authoritative disk reload directly into Monaco's buffer.
* **📂 Full File Explorer**: Create new files, create nested folders, delete files, and browse full directory trees within the container workspace.
* **⚙️ Configurable Run Control**: Split Run button (`[ ▶ Run | ⚙ ]`) with a settings popover to configure project start commands (`node --watch index.js`, `npm run dev`, `python3 main.py`) and pre-run disk flushing.
* **🔒 Authentication & Relational Storage**: Secure email/password authentication using `bcryptjs` and HTTP-only session cookies. PostgreSQL + Prisma ORM stores user accounts, projects, settings, and sandbox metadata.
* **☁️ Ephemeral Compute with Persistent S3 Storage**: Code is persisted to AWS S3 (`code/{replId}/...`) as the source of truth, hydrated into local NVMe workspace volumes upon container start.

---

## 🏗️ Architecture & Data Flow

```
                                  BROWSER CLIENT
         ┌──────────────────────────────┼──────────────────────────────┐
         ▼                              ▼                              ▼
    Monaco Editor                xterm.js Terminal               Live Web Preview
 (Auto-Save & Hot Sync)       (PTY via Socket.IO WS)           (Reverse Proxy iframe)
         │                              │                              │
         └──────────────────────────────┼──────────────────────────────┘
                                        │
                         Unified HTTP & WS Port 3000
                                        ▼
                      ┌───────────────────────────────────┐
                      │    Vessel Unified Server.js       │
                      │                                   │
                      │  • Next.js App Router (SSR & UI)  │
                      │  • Route Handlers & Auth APIs     │
                      │  • /api/preview/:id Reverse Proxy │
                      │  • WebSocket Terminal & PTY Proxy │
                      └───────┬───────────────────┬───────┘
                              │                   │
               ┌──────────────┴─────────┐         │ Docker Daemon API
               ▼                        ▼         ▼
        ┌─────────────┐          ┌─────────────┐  ┌────────────────────────────────┐
        │ PostgreSQL  │          │   AWS S3    │  │       Runner Container         │
        │  (Prisma)   │          │  (Storage)  │  │  • App Server (Port 3000)      │
        │  Metadata   │          │ Code Source │  │  • PTY & Socket.IO (Port 3001) │
        └─────────────┘          └─────────────┘  │  • Bind mount: /workspace      │
                                                  └────────────────────────────────┘
```

---

## 📁 Repository Structure

```
Vessel-main/
├── frontend/                     # Next.js 14 Web Application & Proxy
│   ├── server.js                 # Custom Node.js server (Unified HTTP + WebSocket proxy)
│   ├── prisma/
│   │   └── schema.prisma         # Prisma schema for PostgreSQL
│   ├── src/app/
│   │   ├── page.tsx              # Modern landing page
│   │   ├── signin/page.tsx       # Authentication (Sign in / Sign up)
│   │   ├── projects/
│   │   │   ├── page.tsx          # User projects dashboard
│   │   │   └── [projectId]/      # Dynamic project workspace route
│   │   └── api/                  # API Route Handlers
│   │       ├── auth/             # Login, signup, me, logout
│   │       ├── docker-status/    # Docker daemon health check
│   │       ├── preview/          # Container reverse proxy (/api/preview/:id)
│   │       └── projects/         # Project lifecycle (start, stop, run, sync, files)
│   ├── src/components/
│   │   ├── editor/               # Monaco Editor, File Explorer & File Tree
│   │   ├── terminal/             # xterm.js terminal with Socket.IO connection
│   │   ├── preview/              # Embedded live preview iframe
│   │   ├── workspace/            # Main IDE shell, panel layouts & Run control
│   │   └── projects/             # Project cards, creation modal & templates
│   ├── src/lib/
│   │   ├── db/                   # Prisma database client
│   │   ├── auth/                 # Password hashing & JWT sessions
│   │   ├── s3/                   # AWS S3 sync, templates & disk storage
│   │   └── docker.ts             # Dockerode sandbox management & resource limits
│   └── src/services/             # Decoupled business logic service layer
│
├── runner/                       # Sandbox Container Image
│   ├── Dockerfile                # Runner Docker image definition
│   ├── src/index.ts              # Express API & container entrypoint (:3001)
│   ├── src/ws.ts                 # Socket.IO handlers for PTY & live file broadcast
│   ├── src/pty.ts                # node-pty pseudo-terminal wrapper for bash
│   ├── src/fs.ts                 # Local container filesystem operations
│   └── src/aws.ts                # S3 sync operations inside container
│
├── templates/                    # Starter project boilerplate
│   ├── node-js/                  # Node.js starter (index.js, package.json with --watch)
│   └── python/                   # Python starter (main.py)
│
├── infra/                        # Infrastructure
│   └── docker-compose.yml        # Development stack (PostgreSQL + Runner)
│
└── scripts/                      # Setup & Verification Scripts
    ├── seed-s3.js                # Uploads starter templates to S3 bucket
    └── verify-sandbox.js         # Validates Docker engine, PostgreSQL & S3
```

---

## 🛠️ Getting Started (Local Development)

### Prerequisites

* **Node.js**: v20.x or higher
* **Docker**: Docker Desktop or Docker Engine running locally
* **PostgreSQL**: Running locally or via Docker
* **AWS S3**: An S3 bucket (or compatible storage like MinIO)

### 1. Clone & Configure Environment

```bash
git clone https://github.com/RIKKY-J/Vessel-V2.git
cd Vessel-V2/frontend
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# Database
DATABASE_URL="postgresql://vessel_user:vessel_password@localhost:5432/vessel?schema=public"

# Auth Session
SESSION_SECRET="your_secure_random_jwt_secret_min_32_characters"

# AWS S3 Configuration
S3_BUCKET="your-s3-bucket-name"
AWS_ACCESS_KEY_ID="your_aws_access_key_id"
AWS_SECRET_ACCESS_KEY="your_aws_secret_access_key"
AWS_REGION="us-east-1"

# Docker Sandbox Image
RUNNER_IMAGE="rikkyj/runner:latest"
```

### 2. Install Dependencies & Initialize Database

```bash
cd frontend
npm install
npx prisma generate
npx prisma db push
```

### 3. Build the Runner Docker Image (Optional if using pre-built image)

```bash
cd ../runner
docker build -t rikkyj/runner:latest .
```

### 4. Start the Application

```bash
cd ../frontend
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to create an account and launch your first sandbox!

---

## ☁️ Production Deployment (AWS EC2)

### 1. Server Prerequisites on Ubuntu 22.04 / 24.04

```bash
# Update system & install Node.js 20, Docker, and PM2
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs docker.io git
sudo npm install -g pm2

# Add current user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Pull Code & Build Frontend

```bash
cd ~
git clone https://github.com/RIKKY-J/Vessel-V2.git Vessel-main
cd Vessel-main/frontend

# Configure environment
cp .env.example .env.local
nano .env.local

# Install & Build
npm install
npx prisma generate
npx prisma db push
npm run build
```

### 3. Launch via PM2

```bash
# Start the unified server on Port 3000
pm2 start server.js --name "vessel"
pm2 save
pm2 startup
```

The application is now live on `http://<your-ec2-ip>:3000`!

---

## 🔒 Security & Sandbox Isolation

To execute untrusted user code safely, Vessel enforces strict multi-layered isolation:

| Security Measure | Implementation |
|---|---|
| **CPU Restriction** | Hard limit of 1 CPU core (`NanoCpus: 1000000000`) per container. |
| **Memory Limit** | Hard cap of 512 MB RAM (`Memory: 536870912`) to eliminate OOM risks on the host. |
| **Process Limit** | Maximum of 100 PIDs (`PidsLimit: 100`) to prevent fork bombs. |
| **Socket Shielding** | `/var/run/docker.sock` is never mounted or accessible inside user sandboxes. |
| **Filesystem Isolation** | User code executes strictly within isolated bind-mounted `/workspace` directories. |
| **Session Security** | Passwords hashed with `bcryptjs` (salt rounds: 10); HTTP-only, SameSite session cookies. |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Enter` / `Cmd + Enter` | Save files and execute current Run command |
| `Ctrl + S` / `Cmd + S` | Immediately save dirty files to disk & S3 |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
