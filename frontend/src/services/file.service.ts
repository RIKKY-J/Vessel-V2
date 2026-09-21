import { projectService } from "./project.service";
import { fetchProjectFiles, saveProjectFile, syncFilesToS3 } from "@/lib/s3/projects";

export class FileService {
  async getProjectFiles(replId: string, userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }
    return fetchProjectFiles(replId);
  }

  async saveFile(replId: string, filePath: string, content: string, userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }
    await saveProjectFile(replId, filePath, content);
    return { success: true };
  }

  async syncFiles(replId: string, files: { path: string; content: string }[], userId?: string) {
    if (userId) {
      await projectService.getProjectByReplId(replId, userId);
    }
    await syncFilesToS3(replId, files);
    return { success: true, count: files.length };
  }
}

export const fileService = new FileService();
