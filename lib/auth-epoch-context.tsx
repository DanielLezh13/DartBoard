"use client";

import { createContext, useContext, type ReactNode } from "react";

const AuthEpochContext = createContext<number>(0);

export function AuthEpochProvider({
  value,
  children,
}: {
  value: number;
  children: ReactNode;
}) {
  return (
    <AuthEpochContext.Provider value={value}>
      {children}
    </AuthEpochContext.Provider>
  );
}

export function useAuthEpoch(): number {
  return useContext(AuthEpochContext);
}
