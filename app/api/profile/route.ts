import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, saveUserProfile } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

const MAX_DISPLAY_NAME_CHARS = 32;
const MAX_PERSONAL_CONTEXT_CHARS = 500;
const MAX_PREFERENCES_CHARS = 700;
const ALLOWED_STYLES = new Set(["concise", "balanced", "detailed"]);

const PROFILE_BLOCKED_PATTERNS: RegExp[] = [
  /\b(nazi|white\s+power|kkk|racial\s+suprem\w*|ethnic\s+cleansing|genocide|hate\s*speech)\b/i,
  /n[\W_]*i[\W_]*g[\W_]*g[\W_]*(?:e[\W_]*r|a)\b/i,
  /\b(f[\W_]*a[\W_]*g[\W_]*g[\W_]*o[\W_]*t|k[\W_]*i[\W_]*k[\W_]*e|s[\W_]*p[\W_]*i[\W_]*c)\b/i,
  /\b(sexual\s+roleplay|rape\s+fantas(?:y|ies)|child\s*(?:sexual\s*abuse|porn)|bestiality|incest)\b/i,
  /\b(ignore|override|bypass)\b[\s\S]{0,48}\b(instruction|rules?|policy|safety|guardrails?)\b/i,
  /\b(system\s+prompt|developer\s+message|jailbreak)\b/i,
];

function normalizeProfileText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

function parseOptionalTextField(
  raw: unknown,
  fieldName: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `${fieldName} must be a string.` };
  }
  const normalized = normalizeProfileText(raw);
  return { ok: true, value: normalized.length > 0 ? normalized : null };
}

function validateProfileFieldSafety(
  value: string | null,
  fieldName: string
): { ok: true } | { ok: false; error: string } {
  if (!value) {
    return { ok: true };
  }
  if (PROFILE_BLOCKED_PATTERNS.some((pattern) => pattern.test(value))) {
    return { ok: false, error: `${fieldName} contains disallowed content. Please rephrase.` };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  try {
    const scope = await getServerScope(request);
    
    if (!scope) {
      // No scope - return default profile
      return NextResponse.json({
        display_name: null,
        style: null,
        preferences: null,
        core_spec: "",
        personal_context: null,
        plan: "free",
      });
    }

    if (scope.kind !== "user") {
      return NextResponse.json({
        display_name: null,
        style: null,
        preferences: null,
        core_spec: "",
        personal_context: null,
        plan: "free",
      });
    }
    
    const profile = getUserProfile(scope.userId);
    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { display_name, style, preferences, core_spec, personal_context } = body;

    // Get scope
    const scope = await getServerScope(request);
    
    if (!scope) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to update profile" },
        { status: 403 }
      );
    }

    const parsedDisplayName = parseOptionalTextField(display_name, "Display name");
    if (!parsedDisplayName.ok) {
      return NextResponse.json({ error: parsedDisplayName.error }, { status: 400 });
    }
    const parsedPersonalContext = parseOptionalTextField(personal_context, "Personal context");
    if (!parsedPersonalContext.ok) {
      return NextResponse.json({ error: parsedPersonalContext.error }, { status: 400 });
    }
    const parsedPreferences = parseOptionalTextField(preferences, "Behavioral guidelines");
    if (!parsedPreferences.ok) {
      return NextResponse.json({ error: parsedPreferences.error }, { status: 400 });
    }
    const parsedCoreSpec = parseOptionalTextField(core_spec, "Core spec");
    if (!parsedCoreSpec.ok) {
      return NextResponse.json({ error: parsedCoreSpec.error }, { status: 400 });
    }

    const normalizedStyle =
      style == null ? null : typeof style === "string" ? style.trim().toLowerCase() : "__invalid__";
    if (normalizedStyle === "__invalid__") {
      return NextResponse.json({ error: "Style must be a string." }, { status: 400 });
    }
    if (normalizedStyle && !ALLOWED_STYLES.has(normalizedStyle)) {
      return NextResponse.json({ error: "Invalid style value." }, { status: 400 });
    }

    if (parsedDisplayName.value && parsedDisplayName.value.length > MAX_DISPLAY_NAME_CHARS) {
      return NextResponse.json(
        { error: `Display name must be ${MAX_DISPLAY_NAME_CHARS} characters or less` },
        { status: 400 }
      );
    }
    if (parsedPersonalContext.value && parsedPersonalContext.value.length > MAX_PERSONAL_CONTEXT_CHARS) {
      return NextResponse.json(
        { error: `Personal context must be ${MAX_PERSONAL_CONTEXT_CHARS} characters or less` },
        { status: 400 }
      );
    }
    if (parsedPreferences.value && parsedPreferences.value.length > MAX_PREFERENCES_CHARS) {
      return NextResponse.json(
        { error: `Behavioral guidelines must be ${MAX_PREFERENCES_CHARS} characters or less` },
        { status: 400 }
      );
    }

    const safetyChecks = [
      validateProfileFieldSafety(parsedDisplayName.value, "Display name"),
      validateProfileFieldSafety(parsedPersonalContext.value, "Personal context"),
      validateProfileFieldSafety(parsedPreferences.value, "Behavioral guidelines"),
    ];
    const failedCheck = safetyChecks.find((result) => !result.ok);
    if (failedCheck && !failedCheck.ok) {
      return NextResponse.json({ error: failedCheck.error }, { status: 400 });
    }

    const profile = saveUserProfile({
      display_name: parsedDisplayName.value,
      style: normalizedStyle,
      preferences: parsedPreferences.value,
      core_spec: parsedCoreSpec.value || "",
      personal_context: parsedPersonalContext.value,
    }, scope.userId);

    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error saving profile:", error);
    return NextResponse.json(
      { error: "Failed to save profile" },
      { status: 500 }
    );
  }
}
