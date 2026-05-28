import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { getServerScope } from "@/lib/scope-server";
import { getDb } from "@/lib/db";
import { MAX_IMAGE_SIZE_BYTES } from "@/lib/limits";
import {
  getDailyUsageCount,
  getScopePlanLimits,
  incrementDailyUsage,
} from "@/lib/plan";
import { enforceApiRateLimit } from "@/lib/rateLimit";
import {
  ensurePrivateUploadsDir,
  getPrivateUploadPath,
  getPrivateUploadUrl,
  getUploadMimeType,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";

const MAGIC_SIGNATURES: { bytes: number[]; ext: string }[] = [
  { bytes: [0xFF, 0xD8, 0xFF], ext: "jpg" },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], ext: "png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], ext: "gif" },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: "webp" }, // RIFF header; WebP also has "WEBP" at offset 8
];

function detectImageType(buf: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (buf.length < sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => buf[i] === b)) {
      if (sig.ext === "webp") {
        if (buf.length < 12 || buf.toString("ascii", 8, 12) !== "WEBP") return null;
      }
      return sig.ext;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    let scope;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required for image upload" },
        { status: 403 }
      );
    }
    const db = getDb();
    const rateLimited = enforceApiRateLimit({
      db,
      request,
      route: { routeKey: "/api/upload/image", limit: 10, windowMs: 10 * 60 * 1000 },
      scope,
    });
    if (rateLimited) {
      return rateLimited;
    }
    const { limits } = getScopePlanLimits(db, scope);

    if (Number.isFinite(limits.maxImageUploadsPerDay)) {
      const uploadsToday = getDailyUsageCount(db, scope.userId, "image_upload");
      if (uploadsToday >= limits.maxImageUploadsPerDay) {
        return NextResponse.json(
          { error: "Daily image upload cap reached. Please continue tomorrow." },
          { status: 429 }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file size first (before reading full buffer)
    const maxImageSizeBytes = Number.isFinite(limits.maxImageSizeBytes)
      ? limits.maxImageSizeBytes
      : MAX_IMAGE_SIZE_BYTES;
    if (file.size > maxImageSizeBytes) {
      const sizeMb = Math.round(maxImageSizeBytes / (1024 * 1024));
      return NextResponse.json(
        { error: `File size exceeds ${sizeMb} MB limit` },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate by actual file bytes — ignore client-provided type/filename
    const detectedExt = detectImageType(buffer);
    if (!detectedExt) {
      return NextResponse.json(
        { error: "Invalid file. Only real JPEG, PNG, WebP, and GIF images are accepted." },
        { status: 400 }
      );
    }

    await ensurePrivateUploadsDir();

    // Use detected extension, not client-provided filename
    const filename = `${randomUUID()}.${detectedExt}`;
    const filepath = getPrivateUploadPath(filename);
    const mimeType = getUploadMimeType(filename) || file.type || "application/octet-stream";

    await writeFile(filepath, buffer);
    db.prepare(
      `INSERT INTO uploaded_images (stored_name, original_name, mime_type, size_bytes, user_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(filename, file.name || null, mimeType, buffer.byteLength, scope.userId);

    incrementDailyUsage(db, scope.userId, "image_upload");

    return NextResponse.json({
      url: getPrivateUploadUrl(filename),
      filename: filename,
    });
  } catch (error) {
    console.error("Error uploading image:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
