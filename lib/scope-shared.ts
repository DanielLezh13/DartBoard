export type Scope =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string };

export function scopeToWhereClause(scope: Scope): { clause: string; params: any[] } {
  if (scope.kind === "user") {
    return {
      clause: "user_id = ?",
      params: [scope.userId],
    };
  }

  return {
    clause: "guest_id = ?",
    params: [scope.guestId],
  };
}

export function getHeadersForScope(scope: Scope): HeadersInit {
  const base: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (scope.kind === "guest" && scope.guestId) {
    return {
      ...base,
      "x-guest-id": scope.guestId,
    };
  }

  return base;
}
