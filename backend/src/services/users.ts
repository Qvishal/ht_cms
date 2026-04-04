import { db } from "../db";

export type UserRole = "admin" | "user";

export type UserPublic = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

export async function hasAnyAdmin(): Promise<boolean> {
  const rows = await db<{ count: number }>`
    select count(*)::int as count
    from users
    where role = 'admin'
  `;
  return (rows[0]?.count ?? 0) > 0;
}

export async function getUserById(id: string): Promise<UserPublic | null> {
  const rows = await db<UserPublic>`
    select id, email, name, role
    from users
    where id = ${id}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getUserByEmailForLogin(
  email: string,
): Promise<(UserPublic & { password_hash: string }) | null> {
  const rows = await db<UserPublic & { password_hash: string }>`
    select id, email, name, role, password_hash
    from users
    where email = ${email.toLowerCase()}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  name?: string | null;
  passwordHash: string;
  role: UserRole;
}): Promise<UserPublic> {
  const rows = await db<UserPublic>`
    insert into users (email, name, password_hash, role)
    values (
      ${input.email.toLowerCase()},
      ${input.name?.trim() ? input.name.trim() : null},
      ${input.passwordHash},
      ${input.role}
    )
    returning id, email, name, role
  `;
  const user = rows[0];
  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function listUsers(): Promise<UserPublic[]> {
  const rows = await db<UserPublic>`
    select id, email, name, role
    from users
    order by created_at asc
  `;
  return rows;
}

export async function setUserRole(
  userId: string,
  role: UserRole,
): Promise<UserPublic | null> {
  const rows = await db<UserPublic>`
    update users
    set role = ${role}
    where id = ${userId}
    returning id, email, name, role
  `;
  return rows[0] ?? null;
}

export async function countAdmins(): Promise<number> {
  const rows = await db<{ count: number }>`
    select count(*)::int as count
    from users
    where role = 'admin'
  `;
  return rows[0]?.count ?? 0;
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

  const rows = await db<UserPublic>`
    update users
    set
      email = case when ${emailProvided} then ${nextEmail} else email end,
      name = case when ${nameProvided} then ${nextName} else name end,
      password_hash = case when ${passwordProvided} then ${nextPasswordHash} else password_hash end
    where id = ${input.userId}
    returning id, email, name, role
  `;
  return rows[0] ?? null;
}

export async function deleteUserAdmin(userId: string): Promise<boolean> {
  const rows = await db<{ id: string }>`
    delete from users
    where id = ${userId}
    returning id
  `;
  return !!rows[0];
}
