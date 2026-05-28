import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createServerClient } from "@/lib/supabase/server";
import { claimGuestDataToUser } from "@/lib/guest-data";
import { GUEST_COOKIE_NAME, parseSignedGuestCookie } from "@/lib/guest-cookie";

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: "Must be signed in to claim guest data" },
        { status: 401 }
      );
    }

    const userId = user.id;
    const db = getDb();

    let guestId = request.headers.get("x-db-guest-id")?.trim() || null;

    // Legacy fallback while old cookie-based guests age out.
    if (!guestId) {
      const cookieValue = request.cookies.get(GUEST_COOKIE_NAME)?.value ?? null;
      const parsedGuest = await parseSignedGuestCookie(cookieValue);
      guestId = parsedGuest?.guestId ?? null;
    }

    if (!guestId) {
      return NextResponse.json({
        message: "No active guest session found to claim",
        claimed: false,
      });
    }

    const results = claimGuestDataToUser(db, guestId, userId);
    const claimedCount = Object.values(results).reduce((sum, value) => sum + value, 0);

    return NextResponse.json({
      message: claimedCount > 0 ? "Guest data claimed successfully" : "No guest data found to claim",
      claimed: claimedCount > 0,
      results,
    });
    
  } catch (error) {
    console.error("Error claiming guest data:", error);
    return NextResponse.json(
      { error: "Failed to claim guest data" },
      { status: 500 }
    );
  }
}
