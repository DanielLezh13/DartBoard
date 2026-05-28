import { createServerClient } from "@supabase/ssr";
import { NextResponse, NextRequest } from "next/server";
import {
  createGuestId,
  GUEST_COOKIE_NAME,
} from "@/lib/guest-cookie";

function normalizeClientGuestId(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Legacy/sessionStorage guest ids look like: guest-<timestamp>-<random>
  // Keep this strict enough to reject garbage while allowing older values.
  if (!/^guest-[a-z0-9-]{8,128}$/i.test(trimmed)) return null;
  return trimmed;
}

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  const clientGuestId = normalizeClientGuestId(request.headers.get("x-guest-id"));
  const guestIdForRequest = clientGuestId ?? createGuestId();

  // Trusted, server-controlled guest identity for this request.
  requestHeaders.set("x-db-guest-id", guestIdForRequest);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh session if expired
  await supabase.auth.getSession();

  // Remove legacy guest cookie so guest identity is tab-scoped again (sessionStorage header).
  if (request.cookies.has(GUEST_COOKIE_NAME)) {
    response.cookies.set({
      name: GUEST_COOKIE_NAME,
      value: "",
      maxAge: 0,
      path: "/",
    });
  }

  // No auth redirect logic needed - just refresh cookies
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
