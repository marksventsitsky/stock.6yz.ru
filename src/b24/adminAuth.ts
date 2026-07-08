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
