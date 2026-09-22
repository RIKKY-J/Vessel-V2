const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const httpProxy = require("http-proxy");

// Enforce production mode by default for PM2 / server deployment
process.env.NODE_ENV = process.env.NODE_ENV || "production";
const dev = process.env.NODE_ENV === "development";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

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

    // Proxy Socket.IO HTTP long-polling to local runner container on port 3001
    if (parsedUrl.pathname && parsedUrl.pathname.startsWith("/socket.io/")) {
      proxy.web(req, res, { target: "http://127.0.0.1:3001" });
      return;
    }

    // Default Next.js handler
    handle(req, res, parsedUrl);
  });

  // Proxy WebSocket upgrades on port 3000
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url, true);

    if (pathname && pathname.startsWith("/socket.io/")) {
      proxy.ws(req, socket, head, { target: "http://127.0.0.1:3001" });
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
