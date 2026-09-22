const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function isIpv4(str) {
  return typeof str === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(str.trim());
}

function getPublicIp() {
  if (process.env.PUBLIC_IP && isIpv4(process.env.PUBLIC_IP)) return process.env.PUBLIC_IP.trim();
  try {
    const token = execSync('curl -s -f -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --connect-timeout 2', { encoding: "utf8" }).trim();
    if (token) {
      const ip = execSync(`curl -s -f -H "X-aws-ec2-metadata-token: ${token}" http://169.254.169.254/latest/meta-data/public-ipv4 --connect-timeout 2`, { encoding: "utf8" }).trim();
      if (isIpv4(ip)) return ip;
    }
  } catch {}
  try {
    const res = execSync("curl -s -f --connect-timeout 3 https://api.ipify.org", { encoding: "utf8" }).trim();
    if (isIpv4(res)) return res;
  } catch {}
  try {
    const res = execSync("curl -s -f --connect-timeout 3 https://ifconfig.me", { encoding: "utf8" }).trim();
    if (isIpv4(res)) return res;
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
  console.log(`[SSL Setup] Generating Direct HTTPS Certificate for IP: ${ip}`);

  const san = `IP:${ip},IP:127.0.0.1,DNS:${ip}.sslip.io,DNS:localhost`;
  let cmd = `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=${ip}" -addext "subjectAltName = ${san}"`;

  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    // Fallback without -addext if older openssl
    console.log("[SSL Setup] Falling back to standard OpenSSL request...");
    cmd = `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=${ip}"`;
    execSync(cmd, { stdio: "inherit" });
  }

  console.log(`\n✓ SSL certificates ready:`);
  console.log(`  - Private Key: ${keyPath}`);
  console.log(`  - Certificate: ${certPath}`);
  console.log(`\n======================================================`);
  console.log(`  DIRECT HTTPS ON PORT 3000 IS CONFIGURED!`);
  console.log(`  Access URL: https://${ip}:3000`);
  console.log(`======================================================\n`);
}

generateCertificates();
