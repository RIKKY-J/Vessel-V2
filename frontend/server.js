const { createServer } = require("http");
const { parse } = require("url");
const fs = require("fs");
const path = require("path");
const next = require("next");
const httpProxy = require("http-proxy");

// Enforce production mode by default for PM2 / server deployment
process.env.NODE_ENV = process.env.NODE_ENV || "production";
const dev = process.env.NODE_ENV === "development";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

// Helper to look up active runner port for replId or fallback to 3001
function getActiveRunnerPort(replId) {
  try {
    const file = path.join(__dirname, "data", "active-sandboxes.json");
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (replId && data[replId]?.runnerPort) return data[replId].runnerPort;
      const keys = Object.keys(data);
      if (keys.length > 0 && data[keys[keys.length - 1]]?.runnerPort) {
        return data[keys[keys.length - 1]].runnerPort;
      }
    }
  } catch {}
  return 3001;
}

// Create WebSocket and HTTP proxy for runner sandboxes
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err, req, res) => {
  console.warn("[WS Proxy] Target runner error:", err.message);
  if (res && res.writeHead && !res.headersSent) {
    try {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Runner offline", message: err.message }));
    } catch {}
  }
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    // Proxy Socket.IO HTTP long-polling to active runner container
    if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io/")) {
      const replId = parsedUrl.query?.replId;
      const targetPort = getActiveRunnerPort(replId);
      proxy.web(req, res, { target: `http://127.0.0.1:${targetPort}` });
      return;
    }

    // Default Next.js handler
    handle(req, res, parsedUrl);
  });

  // Proxy WebSocket upgrades on port 3000 directly to active runner container
  server.on("upgrade", (req, socket, head) => {
    const parsedUrl = parse(req.url, true);
    const { pathname, query } = parsedUrl;

    if (pathname && pathname.startsWith("/socket.io/")) {
      const replId = query?.replId;
      const targetPort = getActiveRunnerPort(replId);
      proxy.ws(req, socket, head, { target: `http://127.0.0.1:${targetPort}` });
      return;
    }

    // Allow Next.js internal dev HMR websocket if in development mode
    if (dev && typeof app.getUpgradeHandler === "function") {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }

    socket.destroy();
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", (err) => {
    if (err) throw err;
    console.log(`> Vessel unified server (${dev ? "development" : "production"}) listening on port ${port}`);
  });
});
