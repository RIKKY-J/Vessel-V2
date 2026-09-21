import { getS3Client, getS3Bucket } from "./client";
import { S3 } from "aws-sdk";

export interface ProjectFile {
  type: "file" | "dir";
  name: string;
  path: string;
  content?: string;
}

export async function checkProjectExistsInS3(replId: string): Promise<boolean> {
  const s3 = getS3Client();
  const bucket = getS3Bucket();
  try {
    const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: `code/${replId}/`, MaxKeys: 1 }).promise();
    return Boolean(list.Contents && list.Contents.length > 0);
  } catch (err) {
    console.warn(`[S3] checkProjectExistsInS3 error for replId ${replId}:`, err);
    return false;
  }
}

export async function fetchProjectFiles(replId: string): Promise<ProjectFile[]> {
  const s3 = getS3Client();
  const bucket = getS3Bucket();
  const prefix = `code/${replId}/`;
  const files: ProjectFile[] = [];

  try {
    let continuationToken: string | undefined = undefined;
    do {
      const resp: S3.ListObjectsV2Output = await s3
        .listObjectsV2({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
        .promise();

      if (resp.Contents && resp.Contents.length > 0) {
        for (const item of resp.Contents) {
          if (!item.Key) continue;
          const relPath = item.Key.substring(prefix.length).replace(/^\/+/, "");
          if (!relPath || relPath.endsWith("/")) continue;

          // Fetch file content
          try {
            const obj = await s3.getObject({ Bucket: bucket, Key: item.Key }).promise();
            const content = obj.Body ? obj.Body.toString("utf-8") : "";
            const parts = relPath.split("/");
            const name = parts[parts.length - 1];

            files.push({
              type: "file",
              name,
              path: relPath,
              content,
            });
          } catch (fetchErr) {
            console.warn(`[S3] Failed to read object ${item.Key}:`, fetchErr);
          }
        }
      }

      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    return files;
  } catch (err) {
    console.warn(`[S3] fetchProjectFiles error for ${replId}:`, err);
    return [];
  }
}

export async function saveProjectFile(replId: string, filePath: string, content: string): Promise<void> {
  const s3 = getS3Client();
  const bucket = getS3Bucket();
  const cleanPath = filePath.replace(/^\/+/, "");
  const key = `code/${replId}/${cleanPath}`;

  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    })
    .promise();
}

export async function syncFilesToS3(replId: string, files: { path: string; content: string }[]): Promise<void> {
  await Promise.all(
    files.map((file) => saveProjectFile(replId, file.path, file.content))
  );
}

export async function deleteProjectFiles(replId: string): Promise<void> {
  const s3 = getS3Client();
  const bucket = getS3Bucket();
  const prefix = `code/${replId}/`;

  try {
    const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: prefix }).promise();
    if (list.Contents && list.Contents.length > 0) {
      const objects = list.Contents.map((c) => ({ Key: c.Key! }));
      await s3
        .deleteObjects({
          Bucket: bucket,
          Delete: { Objects: objects },
        })
        .promise();
    }
  } catch (err) {
    console.warn(`[S3] deleteProjectFiles error for ${replId}:`, err);
  }
}
