import { NextRequest, NextResponse } from "next/server";
import { getDb, getSessionFolder, setSessionFolder } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import {
  getOwnedChatFolder,
  getOwnedSession,
  parsePositiveInt,
} from "@/lib/ownership";

export const dynamic = "force-dynamic";

// GET - Get folder for a specific session
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const parsedSessionId = parsePositiveInt(sessionId);
    if (parsedSessionId === null) {
      return NextResponse.json(
        { error: "session_id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    const db = getDb();
    const session = getOwnedSession(db, parsedSessionId, scope);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const folderId = getSessionFolder(parsedSessionId);
    return NextResponse.json({ folderId });
  } catch (error) {
    console.error("Error getting session folder:", error);
    return NextResponse.json(
      { error: "Failed to get session folder" },
      { status: 500 }
    );
  }
}

// POST/PUT - Set folder for a session
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, folder_id } = body;

    if (!session_id) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const parsedSessionId = parsePositiveInt(session_id);
    if (parsedSessionId === null) {
      return NextResponse.json(
        { error: "session_id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to update session folders" },
        { status: 403 }
      );
    }
    const db = getDb();

    const session = getOwnedSession(db, parsedSessionId, scope);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    let parsedFolderId: number | null = null;
    if (folder_id !== undefined && folder_id !== null && folder_id !== "") {
      parsedFolderId = parsePositiveInt(folder_id);
      if (parsedFolderId === null) {
        return NextResponse.json(
          { error: "folder_id must be a positive integer or null" },
          { status: 400 }
        );
      }
      if (scope.kind !== "user") {
        return NextResponse.json(
          { error: "Folders are only available for signed-in users" },
          { status: 403 }
        );
      }
      const folder = getOwnedChatFolder(db, parsedFolderId, scope);
      if (!folder) {
        return NextResponse.json(
          { error: "Folder not found" },
          { status: 404 }
        );
      }
    }

    setSessionFolder(parsedSessionId, parsedFolderId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error setting session folder:", error);
    return NextResponse.json(
      { error: "Failed to set session folder" },
      { status: 500 }
    );
  }
}
