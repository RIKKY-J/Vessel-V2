import { projectService } from "./project.service";
import { getSandboxPorts } from "@/lib/docker";

export class TerminalService {
  async getTerminalConfig(replId: string, userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }

    const ports = getSandboxPorts(replId);
    const runnerPort = ports?.runnerPort || 3001;

    return {
      replId,
      runnerPort,
      wsUrl: process.env.NEXT_PUBLIC_RUNNER_WS_URL || `http://localhost:${runnerPort}`,
    };
  }
}

export const terminalService = new TerminalService();
