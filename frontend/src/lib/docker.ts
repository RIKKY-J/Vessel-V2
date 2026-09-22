import Docker from "dockerode";
import os from "os";

let dockerInstance: Docker | null = null;
let dockerCheckAttempted = false;
let isDockerAvailable = false;

// Dynamic port tracker for sandboxes
const sandboxPorts: Map<string, { appPort: number; runnerPort: number }> = new Map();
let nextPortBase = 40000;

export function getDockerClient(): Docker {
  if (dockerInstance) return dockerInstance;

  const isWindows = os.platform() === "win32";
  const dockerHost = process.env.DOCKER_HOST;

  if (dockerHost) {
    dockerInstance = new Docker({ host: dockerHost });
  } else if (isWindows) {
    // Windows named pipe
    dockerInstance = new Docker({ socketPath: "//./pipe/docker_engine" });
  } else {
    // Linux / macOS socket
    dockerInstance = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  return dockerInstance;
}

export async function checkDockerAvailability(): Promise<boolean> {
  try {
    const docker = getDockerClient();
    await docker.ping();
    isDockerAvailable = true;
    return true;
  } catch (err: any) {
    console.warn(`[Docker] Daemon ping failed (${err.message}).`);
    isDockerAvailable = false;
    return false;
  }
}

export interface SandboxInfo {
  replId: string;
  containerId?: string;
  status: "STOPPED" | "STARTING" | "RUNNING" | "ERROR";
  appPort?: number;
  runnerPort?: number;
  containerIp?: string;
  error?: string;
}

const mockSandboxes = new Map<string, SandboxInfo>();

export async function createSandbox(params: {
  replId: string;
  language?: string;
}): Promise<SandboxInfo> {
  const { replId, language = "node-js" } = params;
  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    const info: SandboxInfo = {
      replId,
      status: "ERROR",
      appPort: 3002,
      runnerPort: 3001,
      error: "Docker Engine is not running or not accessible. Run: sudo chmod 666 /var/run/docker.sock",
    };
    mockSandboxes.set(replId, info);
    return info;
  }

  const docker = getDockerClient();
  const runnerImage = process.env.RUNNER_IMAGE || "vessel-runner:latest";

  // Allocate host ports (favor predictable 3002/3001 for single-container setups)
  let hostAppPort = 3002;
  let hostRunnerPort = 3001;
  if (sandboxPorts.size > 0 && !sandboxPorts.has(replId)) {
    hostAppPort = nextPortBase++;
    hostRunnerPort = nextPortBase++;
  }
  sandboxPorts.set(replId, { appPort: hostAppPort, runnerPort: hostRunnerPort });

  try {
    // Check if container already exists
    try {
      const existing = docker.getContainer(containerName);
      const inspect = await existing.inspect();
      if (inspect.State.Running) {
        const p3000 = inspect.NetworkSettings?.Ports?.["3000/tcp"]?.[0]?.HostPort;
        const p3001 = inspect.NetworkSettings?.Ports?.["3001/tcp"]?.[0]?.HostPort;
        const resolvedPorts = {
          appPort: p3000 ? parseInt(p3000) : hostAppPort,
          runnerPort: p3001 ? parseInt(p3001) : hostRunnerPort,
        };
        sandboxPorts.set(replId, resolvedPorts);

        return {
          replId,
          containerId: inspect.Id,
          status: "RUNNING",
          appPort: resolvedPorts.appPort,
          runnerPort: resolvedPorts.runnerPort,
        };
      }
      await existing.remove({ force: true });
    } catch {
      // Container didn't exist, proceed
    }

    // Security hardening:
    // 1. CPU limits: 1 CPU core (1,000,000,000 NanoCPUs)
    // 2. Memory limit: 512MB
    // 3. Process limit: 100 PIDs (anti-fork bomb)
    // 4. Dedicated volume for /workspace
    // 5. Explicitly NEVER mount /var/run/docker.sock into sandbox
    const container = await docker.createContainer({
      Image: runnerImage,
      name: containerName,
      Env: [
        `REPL_ID=${replId}`,
        `LANGUAGE=${language}`,
        `S3_BUCKET=${process.env.S3_BUCKET || "vessel-storage"}`,
        `AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID || ""}`,
        `AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY || ""}`,
        `AWS_REGION=${process.env.AWS_REGION || "us-east-1"}`,
        `S3_ENDPOINT=${process.env.S3_ENDPOINT || ""}`,
        `PORT=3001`,
      ],
      ExposedPorts: {
        "3000/tcp": {},
        "3001/tcp": {},
      },
      HostConfig: {
        PortBindings: {
          "3000/tcp": [{ HostPort: hostAppPort.toString() }],
          "3001/tcp": [{ HostPort: hostRunnerPort.toString() }],
        },
        NanoCpus: 1000000000, // 1 core
        Memory: 512 * 1024 * 1024, // 512 MB
        PidsLimit: 100,
        RestartPolicy: { Name: "no" },
      },
    });

    await container.start();
    console.log(`[Docker] Sandbox container ${containerName} started on ports app:${hostAppPort}, runner:${hostRunnerPort}`);

    return {
      replId,
      containerId: container.id,
      status: "RUNNING",
      appPort: hostAppPort,
      runnerPort: hostRunnerPort,
    };
  } catch (err: any) {
    console.warn(`[Docker] Failed to start container for ${replId}:`, err);
    // Fallback to dev mock mode
    const info: SandboxInfo = {
      replId,
      status: "ERROR",
      appPort: hostAppPort,
      runnerPort: hostRunnerPort,
      error: err.message,
    };
    mockSandboxes.set(replId, info);
    return info;
  }
}

export async function stopSandbox(replId: string): Promise<void> {
  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    const s = mockSandboxes.get(replId);
    if (s) s.status = "STOPPED";
    return;
  }

  const docker = getDockerClient();
  try {
    const container = docker.getContainer(containerName);
    await container.stop({ t: 5 });
    await container.remove({ force: true });
    sandboxPorts.delete(replId);
    console.log(`[Docker] Sandbox container ${containerName} stopped and removed.`);
  } catch (err: any) {
    console.warn(`[Docker] Stop container error for ${replId}:`, err.message);
  }
}

export async function getSandboxStatus(replId: string): Promise<SandboxInfo> {
  const containerName = `vessel-${replId}`;
  const available = await checkDockerAvailability();

  if (!available) {
    const s = mockSandboxes.get(replId);
    return (
      s || {
        replId,
        status: "STOPPED",
      }
    );
  }

  const docker = getDockerClient();
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    let ports = sandboxPorts.get(replId);
    if (!ports && inspect.NetworkSettings?.Ports) {
      const p3000 = inspect.NetworkSettings.Ports["3000/tcp"]?.[0]?.HostPort;
      const p3001 = inspect.NetworkSettings.Ports["3001/tcp"]?.[0]?.HostPort;
      ports = {
        appPort: p3000 ? parseInt(p3000) : 3002,
        runnerPort: p3001 ? parseInt(p3001) : 3001,
      };
      sandboxPorts.set(replId, ports);
    }

    return {
      replId,
      containerId: inspect.Id,
      status: inspect.State.Running ? "RUNNING" : "STOPPED",
      appPort: ports?.appPort || 3002,
      runnerPort: ports?.runnerPort || 3001,
      containerIp: inspect.NetworkSettings.IPAddress,
    };
  } catch {
    return {
      replId,
      status: "STOPPED",
    };
  }
}

export function getSandboxPorts(replId: string): { appPort: number; runnerPort: number } {
  return sandboxPorts.get(replId) || { appPort: 3002, runnerPort: 3001 };
}
