import { S3 } from "aws-sdk";

let s3Client: S3 | null = null;

export function getS3Client(): S3 {
  if (s3Client) return s3Client;

  s3Client = new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.AWS_REGION || "us-east-1",
    s3ForcePathStyle: true,
  });

  return s3Client;
}

export function getS3Bucket(): string {
  return process.env.S3_BUCKET || "vessel-storage";
}

export function normalizeLanguage(lang?: string): string {
  const l = (lang || "").toLowerCase().trim();
  if (l === "python" || l === "py" || l === "python3") return "python";
  if (l === "node" || l === "node-js" || l === "nodejs" || l === "javascript" || l === "js") return "node-js";
  return l || "node-js";
}
