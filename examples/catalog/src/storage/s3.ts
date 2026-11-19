import { S3Client } from "bun";
import type { StorageAssetResult } from "../../../../src/types.ts";

const s3 = new S3Client({
  bucket: process.env.S3_BUCKET || "catalog",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  accessKeyId: process.env.S3_ACCESS_KEY_ID || "testkey",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "testsecret",
});

/**
 * Storage loader backed by S3 (compatible with local-s3, MinIO, AWS S3).
 * Normalizes keys like "product/1/portrait" and "product/1/portrait:2020" to standard S3 folder paths
 * ("product/1/portrait/latest" and "product/1/portrait/2020").
 */
export default async function getS3Asset(key: string): Promise<StorageAssetResult> {
  let s3Key = key.trim().replace(/^\/+/, "");
  if (!s3Key.includes(":")) {
    s3Key = `${s3Key}:latest`;
  }
  s3Key = s3Key.replace(":", "/");

  const file = s3.file(s3Key);
  const stat = await s3.stat(s3Key);

  return {
    bytes: await file.bytes(),
    etag: stat.etag,
    contentType: stat.type || "image/png",
  };
}
