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
// We try multiple strategies to find the active runner port:
// 1. Read from data/active-sandboxes.json (written by docker.ts)
// 2. Probe common runner ports (3001, then 3002-3010)
// 3. Fall back to 3001

let cachedRunnerPort = null;
let lastPortCheck = 0;

function readPortFromFile(replId) {
  try {
    const file = path.join(__dirname, "data", "active-sandboxes.json");
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (replId && data[replId]?.runnerPort) return data[replId].runnerPort;
      // Return most recent entry
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
  // Cache for 5 seconds to avoid hammering probes
  if (cachedRunnerPort && now - lastPortCheck < 5000) {
    return cachedRunnerPort;
  }

  // Strategy 1: Read from persisted file
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
    if (port === parseInt(process.env.PORT || "3000")) continue; // skip Next.js port
    const alive = await probePort(port);
    if (alive) {
      cachedRunnerPort = port;
      lastPortCheck = now;
      console.log(`[Proxy] Discovered active runner on port ${port}`);
      return port;
    }
  }

  // Strategy 3: Default
  cachedRunnerPort = 3001;
  lastPortCheck = now;
  return 3001;
}

// Invalidate cache when we get proxy errors so we re-probe next time
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
  // For HTTP responses
  if (resOrSocket && typeof resOrSocket.writeHead === "function" && !resOrSocket.headersSent) {
    try {
      resOrSocket.writeHead(502, { "Content-Type": "application/json" });
      resOrSocket.end(JSON.stringify({ error: "Runner offline", message: err.message }));
    } catch {}
  }
  // For raw sockets (WebSocket upgrades), just destroy
  if (resOrSocket && typeof resOrSocket.destroy === "function" && !resOrSocket.writeHead) {
    try { resOrSocket.destroy(); } catch {}
  }
});

// ─── Server ──────────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);

    // Proxy Socket.IO HTTP long-polling to active runner container
    if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io/")) {
      const replId = parsedUrl.query?.replId;
      const targetPort = await discoverRunnerPort(replId);
      proxy.web(req, res, { target: `http://127.0.0.1:${targetPort}` });
      return;
    }

    // Default Next.js handler
    handle(req, res, parsedUrl);
  });

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
    console.log(`> Vessel unified server (${dev ? "dev" : "production"}) on port ${port}`);
  });
});
