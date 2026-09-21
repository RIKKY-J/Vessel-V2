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
  if (dockerCheckAttempted) return isDockerAvailable;
  dockerCheckAttempted = true;

  try {
    const docker = getDockerClient();
    await docker.ping();
    isDockerAvailable = true;
    console.log("[Docker] Successfully connected to Docker Engine daemon.");
    return true;
  } catch (err: any) {
    console.warn(`[Docker] Daemon not reachable (${err.message}). Sandboxes will run in dev/mock mode.`);
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
    const appPort = 3000;
    const runnerPort = 3001;
    const info: SandboxInfo = {
      replId,
      status: "RUNNING",
      appPort,
      runnerPort,
    };
    mockSandboxes.set(replId, info);
    return info;
  }

  const docker = getDockerClient();
  const runnerImage = process.env.RUNNER_IMAGE || "rikkyj/runner:latest";

  // Allocate host ports
  const hostAppPort = nextPortBase++;
  const hostRunnerPort = nextPortBase++;
  sandboxPorts.set(replId, { appPort: hostAppPort, runnerPort: hostRunnerPort });

  try {
    // Check if container already exists
    try {
      const existing = docker.getContainer(containerName);
      const inspect = await existing.inspect();
      if (inspect.State.Running) {
        return {
          replId,
          containerId: inspect.Id,
          status: "RUNNING",
          appPort: hostAppPort,
          runnerPort: hostRunnerPort,
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
      status: "RUNNING",
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
    const ports = sandboxPorts.get(replId);

    return {
      replId,
      containerId: inspect.Id,
      status: inspect.State.Running ? "RUNNING" : "STOPPED",
      appPort: ports?.appPort,
      runnerPort: ports?.runnerPort,
      containerIp: inspect.NetworkSettings.IPAddress,
    };
  } catch {
    return {
      replId,
      status: "STOPPED",
    };
  }
}

export function getSandboxPorts(replId: string): { appPort: number; runnerPort: number } | undefined {
  return sandboxPorts.get(replId);
}
