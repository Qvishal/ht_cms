"use client";

import { createContext, useContext } from "react";

export type Me = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
};

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me | null; children: React.ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useMe(): Me | null {
  return useContext(SessionContext);
}

export function isAdmin(me: Me | null): boolean {
  return me?.role === "admin";
}
