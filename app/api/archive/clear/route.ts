import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

/**
 * Clear all archive messages from the database for the current user/guest
 * POST /api/archive/clear
 */
export async function POST(request: NextRequest) {
  try {
    // Get scope for authentication
    const scope = await getServerScope(request);
    
    if (!scope) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    
    const db = getDb();
    
    // Only delete messages for the current user/guest
    const result = db.prepare(
      `DELETE FROM archive_messages 
       WHERE (user_id = ? AND user_id IS NOT NULL) 
       OR (guest_id = ? AND guest_id IS NOT NULL)`
    ).run(
      scope.kind === "user" ? scope.userId : null,
      scope.kind === "guest" ? scope.guestId : null
    );
    
    return NextResponse.json({
      success: true,
      deleted: result.changes,
      message: `Cleared ${result.changes} messages from archive`,
    });
  } catch (error) {
    console.error("Error clearing archive:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear archive" },
      { status: 500 }
    );
  }
}
