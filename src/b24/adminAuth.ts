import type { Db } from "../storage/db.js";
import { callB24 } from "./rest.js";

/** Bitrix24's `user.admin` REST method returns whether the current auth token belongs to a portal admin. */
export async function checkIsAdmin(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string },
): Promise<boolean> {
  if (!ctx.domain || !ctx.memberId || !ctx.accessToken) return false;
  const res = await callB24<boolean>(db, {
    domain: ctx.domain,
    memberId: ctx.memberId,
    accessToken: ctx.accessToken,
    method: "user.admin",
    body: {},
  });
  return res.ok && res.result === true;
}

export type PortalUser = { ID: string; NAME?: string; LAST_NAME?: string; EMAIL?: string; ACTIVE?: boolean };

function formatUserName(u: PortalUser): string {
  const full = [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
  return full || u.EMAIL || `#${u.ID}`;
}

/** Searches active portal users by name/email so an admin can pick one to grant access to. */
export async function searchPortalUsers(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string; query: string },
): Promise<Array<{ userId: number; name: string }>> {
  const res = await callB24<PortalUser[]>(db, {
    domain: ctx.domain,
    memberId: ctx.memberId,
    accessToken: ctx.accessToken,
    method: "user.search",
    body: { FILTER: { ACTIVE: true }, FIND: ctx.query || undefined },
  });
  if (!res.ok) return [];
  return res.result.map((u) => ({ userId: Number(u.ID), name: formatUserName(u) }));
}

