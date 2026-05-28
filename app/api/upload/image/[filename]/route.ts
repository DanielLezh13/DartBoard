import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import {
  getPrivateUploadPath,
  getUploadMimeType,
  sanitizeStoredUploadName,
} from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: { filename: string } }
) {
  try {
    let scope;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to view uploaded images" },
        { status: 403 }
      );
    }

    const { filename: rawFilename } = context.params;
    const filename = sanitizeStoredUploadName(rawFilename);
    if (!filename) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const db = getDb();
    const upload = db
      .prepare(
        `SELECT stored_name, mime_type
         FROM uploaded_images
         WHERE stored_name = ? AND user_id = ?
         LIMIT 1`
      )
      .get(filename, scope.userId) as
      | { stored_name: string; mime_type: string | null }
      | undefined;

    if (!upload) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const fileBuffer = await readFile(getPrivateUploadPath(upload.stored_name));
    const contentType = upload.mime_type || getUploadMimeType(upload.stored_name) || "application/octet-stream";

    return new NextResponse(fileBuffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${upload.stored_name}"`,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    console.error("Error serving uploaded image:", error);
    return NextResponse.json(
      { error: "Failed to load image" },
      { status: 500 }
    );
  }
}
