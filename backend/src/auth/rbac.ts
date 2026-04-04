import { assertIdent } from "../lib/ids";
import {
  type AccessType,
  getAccessTypeForUserOnTableName,
} from "../services/permissions";
import type { UserRole } from "../services/users";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

export function requireAuth(user: AuthUser | null): asserts user is AuthUser {
  if (!user) throw new Error("Unauthorized");
}

export function requireAdmin(user: AuthUser): void {
  if (user.role !== "admin") throw new Error("Forbidden");
}

export async function getTableAccess(
  user: AuthUser,
  tableName: string,
): Promise<AccessType | null> {
  assertIdent(tableName, "table");
  if (user.role === "admin") return "write";
  return await getAccessTypeForUserOnTableName(user.id, tableName);
}

export async function requireTableRead(
  user: AuthUser,
  tableName: string,
): Promise<void> {
  const access = await getTableAccess(user, tableName);
  if (!access) throw new Error("Forbidden");
}

export async function requireTableWrite(
  user: AuthUser,
  tableName: string,
): Promise<void> {
  const access = await getTableAccess(user, tableName);
  if (access !== "write") throw new Error("Forbidden");
}
