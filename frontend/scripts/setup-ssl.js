const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function getPublicIp() {
  if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP;
  try {
    const res = execSync("curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/public-ipv4", { encoding: "utf8" }).trim();
    if (res && res.split(".").length === 4) return res;
  } catch {}
  try {
    const res = execSync("curl -s --connect-timeout 2 https://ifconfig.me", { encoding: "utf8" }).trim();
    if (res && res.split(".").length === 4) return res;
  } catch {}
  return "13.211.129.75";
}

function generateCertificates() {
  const sslDir = path.join(__dirname, "..", "ssl");
  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true });
  }

  const keyPath = path.join(sslDir, "key.pem");
  const certPath = path.join(sslDir, "cert.pem");

  const ip = getPublicIp();
  console.log(`[SSL Setup] Generating SSL Certificate for IP: ${ip} and ${ip}.sslip.io`);

  const san = `IP:${ip},IP:127.0.0.1,DNS:${ip}.sslip.io,DNS:localhost`;
  const cmd = `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=${ip}" -addext "subjectAltName = ${san}"`;

  try {
    execSync(cmd, { stdio: "inherit" });
    console.log(`\n✓ SSL certificates successfully generated:`);
    console.log(`  - Private Key: ${keyPath}`);
    console.log(`  - Certificate: ${certPath}`);
    console.log(`\nVessel server.js will now automatically boot with HTTPS enabled on port 3000!`);
    console.log(`Access your IDE at: https://${ip}:3000\n`);
  } catch (err) {
    console.error(`[SSL Setup Error] OpenSSL command failed:`, err.message);
    process.exit(1);
  }
}

generateCertificates();
