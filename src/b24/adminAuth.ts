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

/** Returns the id of the user whose access token this is (via user.current), or 0. */
export async function getCurrentUserId(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string },
): Promise<number> {
  if (!ctx.domain || !ctx.accessToken) return 0;
  const res = await callB24<{ ID?: string | number }>(db, {
    domain: ctx.domain,
    memberId: ctx.memberId,
    accessToken: ctx.accessToken,
    method: "user.current",
    body: {},
  });
  if (!res.ok) return 0;
  const id = Number(res.result?.ID ?? 0);
  return Number.isFinite(id) ? id : 0;
}

export type PortalUser = { ID: string; NAME?: string; LAST_NAME?: string; EMAIL?: string; ACTIVE?: boolean };

function formatUserName(u: PortalUser): string {
  const full = [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
  return full || u.EMAIL || `#${u.ID}`;
}

/**
 * Searches active portal users by name/last name/email. `user.search`'s FIND is ignored on this
 * portal (it just returns the first page of everyone), so instead we page through user.get
 * (50 per page) and filter server-side. Capped so a huge portal can't run away.
 */
export async function searchPortalUsers(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string; query: string },
): Promise<Array<{ userId: number; name: string }>> {
  const MAX_PAGES = 40; // 40 * 50 = 2000 users
  const tokens = String(ctx.query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const all: PortalUser[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await callB24<PortalUser[]>(db, {
      domain: ctx.domain,
      memberId: ctx.memberId,
      accessToken: ctx.accessToken,
      method: "user.get",
      body: { FILTER: { ACTIVE: true }, start: page * 50 },
    });
    if (!res.ok || !Array.isArray(res.result) || res.result.length === 0) break;
    all.push(...res.result);
    if (res.result.length < 50) break;
  }

  const matched = all.filter((u) => {
    if (!tokens.length) return true;
    const hay = [u.NAME, u.LAST_NAME, u.EMAIL].filter(Boolean).join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });

  // Keep the picker snappy even if a short/empty query matches hundreds.
  return matched.slice(0, 50).map((u) => ({ userId: Number(u.ID), name: formatUserName(u) }));
}

