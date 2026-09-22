const { createServer } = require("http");
const { parse } = require("url");
const fs = require("fs");
const path = require("path");
const net = require("net");
const next = require("next");
const httpProxy = require("http-proxy");

// Enforce production mode by default for PM2 / server deployment
process.env.NODE_ENV = process.env.NODE_ENV || "production";
const dev = process.env.NODE_ENV === "development";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

// ─── Dynamic Runner Port Discovery ───────────────────────────────────────────
let cachedRunnerPort = null;
let lastPortCheck = 0;

function readPortFromFile(replId) {
  try {
    const file = path.join(__dirname, "data", "active-sandboxes.json");
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (replId && data[replId]?.runnerPort) return data[replId].runnerPort;
      const keys = Object.keys(data);
      if (keys.length > 0) {
        const last = data[keys[keys.length - 1]];
        if (last?.runnerPort) return last.runnerPort;
      }
    }
  } catch {}
  return null;
}

function probePort(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(300);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, "127.0.0.1");
  });
}

async function discoverRunnerPort(replId) {
  const now = Date.now();
  if (cachedRunnerPort && now - lastPortCheck < 3000) {
    return cachedRunnerPort;
  }

  // Strategy 1: Read from persisted file and verify alive
  const fromFile = readPortFromFile(replId);
  if (fromFile) {
    const alive = await probePort(fromFile);
    if (alive) {
      cachedRunnerPort = fromFile;
      lastPortCheck = now;
      return fromFile;
    }
  }

  // Strategy 2: Probe common runner ports
  const candidates = [3001, 3002, 3003, 3004, 3005, 40000, 40001, 40002];
  for (const port of candidates) {
    if (port === parseInt(process.env.PORT || "3000")) continue;
    const alive = await probePort(port);
    if (alive) {
      cachedRunnerPort = port;
      lastPortCheck = now;
      console.log(`[Proxy] Discovered active runner on port ${port}`);
      return port;
    }
  }

  // Strategy 3: Fall back to file value or 3001
  return fromFile || 3001;
}

function invalidatePortCache() {
  cachedRunnerPort = null;
  lastPortCheck = 0;
}

// ─── HTTP Proxy ──────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err, req, resOrSocket) => {
  console.warn("[Proxy] Error:", err.message);
  invalidatePortCache();
  if (resOrSocket && typeof resOrSocket.writeHead === "function" && !resOrSocket.headersSent) {
    try {
      resOrSocket.writeHead(502, { "Content-Type": "application/json" });
      resOrSocket.end(JSON.stringify({ error: "Runner offline or booting", message: err.message }));
    } catch {}
  }
  if (resOrSocket && typeof resOrSocket.destroy === "function" && !resOrSocket.writeHead) {
    try { resOrSocket.destroy(); } catch {}
  }
});

// ─── Direct Docker Diagnostics (Bypasses Next.js Compilation) ─────────────────
async function handleDockerStatus(req, res, parsedUrl) {
  res.setHeader("Content-Type", "application/json");
  try {
    const Docker = require("dockerode");
    const isWindows = process.platform === "win32";
    const docker = new Docker(
      process.env.DOCKER_HOST
        ? { host: process.env.DOCKER_HOST }
        : isWindows
        ? { socketPath: "//./pipe/docker_engine" }
        : { socketPath: "/var/run/docker.sock" }
    );

    // Optional cleanup action: /api/docker-status?action=cleanup
    if (parsedUrl.query?.action === "cleanup") {
      const all = await docker.listContainers({ all: true });
      let removedCount = 0;
      for (const c of all) {
        if (c.Names.some((n) => n.includes("vessel-"))) {
          try {
            const cont = docker.getContainer(c.Id);
            if (c.State === "running") await cont.stop({ t: 2 });
            await cont.remove({ force: true });
            removedCount++;
          } catch {}
        }
      }
      res.end(JSON.stringify({ success: true, message: `Removed ${removedCount} vessel containers` }));
      return;
    }

    await docker.ping();
    const rawContainers = await docker.listContainers({ all: true });
    const containers = await Promise.all(
      rawContainers.map(async (c) => {
        let logs = "";
        let inspectData = null;
        try {
          const cont = docker.getContainer(c.Id);
          inspectData = await cont.inspect();
          const logBuf = await cont.logs({ stdout: true, stderr: true, tail: 50 });
          logs = logBuf ? logBuf.toString("utf8") : "";
        } catch (e) {
          logs = `Logs error: ${e.message}`;
        }
        return {
          id: c.Id.substring(0, 12),
          names: c.Names,
          image: c.Image,
          state: c.State,
          status: c.Status,
          exitCode: inspectData?.State?.ExitCode,
          error: inspectData?.State?.Error,
          startedAt: inspectData?.State?.StartedAt,
          finishedAt: inspectData?.State?.FinishedAt,
          ports: c.Ports,
          logs,
        };
      })
    );

    let activeSandboxes = {};
    try {
      const p = path.join(__dirname, "data", "active-sandboxes.json");
      if (fs.existsSync(p)) activeSandboxes = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}

    res.end(
      JSON.stringify(
        {
          dockerAvailable: true,
          containers,
          activeSandboxes,
          serverPort: process.env.PORT || "3000",
        },
        null,
        2
      )
    );
  } catch (err) {
    res.end(JSON.stringify({ dockerAvailable: false, error: err.message }, null, 2));
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const requestHandler = async (req, res) => {
    const parsedUrl = parse(req.url, true);

    // Direct Docker diagnostic endpoint in server.js (instant, no build needed)
    if (parsedUrl.pathname === "/api/docker-status") {
      return handleDockerStatus(req, res, parsedUrl);
    }

    // Proxy Socket.IO HTTP long-polling to active runner container
    if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io/")) {
      const replId = parsedUrl.query?.replId;
      const targetPort = await discoverRunnerPort(replId);
      proxy.web(req, res, { target: `http://127.0.0.1:${targetPort}` });
      return;
    }

    // Default Next.js handler
    handle(req, res, parsedUrl);
  };

  const server = createServer(requestHandler);

  // Proxy WebSocket upgrade requests
  server.on("upgrade", async (req, socket, head) => {
    const parsedUrl = parse(req.url, true);
    const { pathname, query } = parsedUrl;

    if (pathname && pathname.startsWith("/socket.io/")) {
      const replId = query?.replId;
      const targetPort = await discoverRunnerPort(replId);
      console.log(`[Proxy] WS upgrade for replId=${replId} → 127.0.0.1:${targetPort}`);
      proxy.ws(req, socket, head, { target: `http://127.0.0.1:${targetPort}` });
      return;
    }

    // Allow Next.js dev HMR
    if (dev && typeof app.getUpgradeHandler === "function") {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }

    socket.destroy();
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", (err) => {
    if (err) throw err;
    console.log(`> Vessel unified server (${dev ? "dev" : "production"}) on http://0.0.0.0:${port}`);
  });
});
