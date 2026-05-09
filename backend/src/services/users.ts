import { db, sql } from "../db";
import { newId } from "../lib/uuid";

export type UserRole = "admin" | "user";

export type UserPublic = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

export async function hasAnyAdmin(): Promise<boolean> {
  const rows = await db.query<{ count: number | string }>(
    sql`
      select count(*) as count
      from users
      where role = 'admin'
    `,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

export async function getUserById(id: string): Promise<UserPublic | null> {
  const rows = await db.query<UserPublic>(
    sql`
      select id, email, name, role
      from users
      where id = ${id}
      limit 1
    `,
  );
  return rows[0] ?? null;
}

export async function getUserByEmailForLogin(
  email: string,
): Promise<(UserPublic & { password_hash: string }) | null> {
  const rows = await db.query<UserPublic & { password_hash: string }>(
    sql`
      select id, email, name, role, password_hash
      from users
      where email = ${email.toLowerCase()}
      limit 1
    `,
  );
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  name?: string | null;
  passwordHash: string;
  role: UserRole;
}): Promise<UserPublic> {
  const id = newId();
  await db.query(
    sql`
      insert into users (id, email, name, password_hash, role)
      values (
        ${id},
        ${input.email.toLowerCase()},
        ${input.name?.trim() ? input.name.trim() : null},
        ${input.passwordHash},
        ${input.role}
      )
    `,
  );
  const user = await getUserById(id);
  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function listUsers(): Promise<UserPublic[]> {
  const rows = await db.query<UserPublic>(
    sql`
      select id, email, name, role
      from users
      order by created_at asc
    `,
  );
  return rows;
}

export async function setUserRole(
  userId: string,
  role: UserRole,
): Promise<UserPublic | null> {
  await db.query(
    sql`
      update users
      set role = ${role}
      where id = ${userId}
    `,
  );
  return await getUserById(userId);
}

export async function countAdmins(): Promise<number> {
  const rows = await db.query<{ count: number | string }>(
    sql`
      select count(*) as count
      from users
      where role = 'admin'
    `,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function updateUserAdmin(input: {
  userId: string;
  email?: string;
  name?: string | null;
  passwordHash?: string;
}): Promise<UserPublic | null> {
  const emailProvided = input.email !== undefined;
  const nextEmail = input.email ? input.email.toLowerCase() : null;

  const nameProvided = input.name !== undefined;
  const nextName = input.name?.trim() ? input.name.trim() : null;

  const passwordProvided = input.passwordHash !== undefined;
  const nextPasswordHash = input.passwordHash ?? null;

  await db.query(
    sql`
      update users
      set
        email = case when ${emailProvided} then ${nextEmail} else email end,
        name = case when ${nameProvided} then ${nextName} else name end,
        password_hash = case when ${passwordProvided} then ${nextPasswordHash} else password_hash end
      where id = ${input.userId}
    `,
  );
  return await getUserById(input.userId);
}

export async function deleteUserAdmin(userId: string): Promise<boolean> {
  await db.query(
    sql`
      delete from users
      where id = ${userId}
    `,
  );
  const still = await getUserById(userId);
  return !still;
}
