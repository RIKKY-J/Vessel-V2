const http = require("http");
const https = require("https");
const { parse } = require("url");
const fs = require("fs");
const path = require("path");
const net = require("net");
const next = require("next");
const httpProxy = require("http-proxy");

// ─── SSL Certificate Detection ───────────────────────────────────────────────
const sslCertPath =
  process.env.SSL_CERT_PATH ||
  path.join(__dirname, "ssl", "cert.pem");
const sslKeyPath =
  process.env.SSL_KEY_PATH ||
  path.join(__dirname, "ssl", "key.pem");

let sslOptions = null;
if (fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
  try {
    sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };
    console.log(`[SSL] Loaded certificates from ${sslCertPath}`);
  } catch (err) {
    console.warn(`[SSL] Warning: Could not read certificate files: ${err.message}`);
  }
} else if (process.env.HTTPS === "true" || process.env.ENABLE_HTTPS === "true" || process.argv.includes("--https")) {
  try {
    console.log("[SSL] Generating local SSL certificates...");
    require("./scripts/setup-ssl");
    if (fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
      sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath),
      };
    }
  } catch (e) {
    console.warn("[SSL] Auto-generation error:", e.message);
  }
}

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

  const isHttps = !!sslOptions;
  const server = isHttps
    ? https.createServer(sslOptions, requestHandler)
    : http.createServer(requestHandler);

  // If a client attempts plain HTTP against the HTTPS port, redirect gracefully
  if (isHttps) {
    server.on("clientError", (err, socket) => {
      if (err.code === "ERR_SSL_HTTP_REQUEST" || (err.message && err.message.includes("http request"))) {
        const port = process.env.PORT || "3000";
        const redirectPortStr = port === "443" ? "" : `:${port}`;
        const host = "13.211.129.75";
        const target = `https://${host}${redirectPortStr}/`;
        socket.end(
          `HTTP/1.1 302 Found\r\nLocation: ${target}\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n` +
          `<html><head><meta http-equiv="refresh" content="0;url=${target}"></head><body>Redirecting to <a href="${target}">${target}</a></body></html>`
        );
        return;
      }
      socket.destroy();
    });
  }

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
    const protocol = isHttps ? "https" : "http";
    console.log(`> Vessel unified server (${dev ? "dev" : "production"}) on ${protocol}://0.0.0.0:${port}`);
    if (isHttps) {
      console.log(`> [HTTPS ACTIVE] Secure connection ready at https://13.211.129.75:${port}`);
    }
  });

  // Optional: Redirect port 80 to port 443 if running on standard HTTPS port 443
  if (isHttps && port === 443) {
    const httpRedirect = http.createServer((req, res) => {
      const host = req.headers.host ? req.headers.host.split(":")[0] : "13.211.129.75";
      res.writeHead(301, { Location: `https://${host}${req.url}` });
      res.end();
    });
    httpRedirect.listen(80, "0.0.0.0", () => {
      console.log("> HTTP Port 80 redirecting to HTTPS Port 443");
    });
  }
});
