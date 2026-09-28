import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";

export type Provider = "google" | "dropbox";

export async function getConnection(provider: Provider) {
  const [row] = await db.select().from(connections).where(eq(connections.provider, provider));
  return row ?? null;
}

export async function saveConnection(
  provider: Provider,
  values: { refreshToken: string; accessToken?: string | null; expiresAt?: Date | null; accountEmail?: string | null },
) {
  const row = { provider, ...values, updatedAt: new Date() };
  await db.insert(connections).values(row).onConflictDoUpdate({ target: connections.provider, set: row });
}

export async function updateAccessToken(provider: Provider, accessToken: string, expiresAt: Date) {
  await db
    .update(connections)
    .set({ accessToken, expiresAt, updatedAt: new Date() })
    .where(eq(connections.provider, provider));
}

export async function deleteConnection(provider: Provider) {
  await db.delete(connections).where(eq(connections.provider, provider));
}
