import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { wipeGuestDataByGuestId } from "@/lib/guest-data";
import { enforceApiRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let scope;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (scope.kind !== "guest") {
      return NextResponse.json(
        { error: "Cannot wipe guest data while signed in" },
        { status: 400 }
      );
    }

    const db = getDb();
    const rateLimited = enforceApiRateLimit({
      db,
      request,
      route: { routeKey: "/api/guest/wipe", limit: 5, windowMs: 10 * 60 * 1000 },
      scope,
    });
    if (rateLimited) {
      return rateLimited;
    }

    const results = wipeGuestDataByGuestId(db, scope.guestId);
    const wipedCount = Object.values(results).reduce((sum, value) => sum + value, 0);
    
    return NextResponse.json({
      message: wipedCount > 0 ? "Guest data wiped successfully" : "No guest data found to wipe",
      wiped: wipedCount > 0,
      results,
    });
    
  } catch (error) {
    console.error("Error wiping guest data:", error);
    return NextResponse.json(
      { error: "Failed to wipe guest data" },
      { status: 500 }
    );
  }
}
