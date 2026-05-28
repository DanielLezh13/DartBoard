import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { extname, join } from "path";

const PRIVATE_UPLOAD_ROUTE_PREFIX = "/api/upload/image";

const MIME_BY_EXT: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function getPrivateUploadsDir(): string {
  return join(process.cwd(), "storage", "uploads");
}

export async function ensurePrivateUploadsDir(): Promise<string> {
  const uploadsDir = getPrivateUploadsDir();
  if (!existsSync(uploadsDir)) {
    await mkdir(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

export function sanitizeStoredUploadName(input: string): string | null {
  const trimmed = String(input || "").trim();
  if (!/^[a-f0-9-]+\.(gif|jpe?g|png|webp)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function getPrivateUploadPath(storedName: string): string {
  return join(getPrivateUploadsDir(), storedName);
}

export function getPrivateUploadUrl(storedName: string): string {
  return `${PRIVATE_UPLOAD_ROUTE_PREFIX}/${storedName}`;
}

export function getUploadMimeType(fileName: string): string | null {
  return MIME_BY_EXT[extname(fileName).toLowerCase()] || null;
}
