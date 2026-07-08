import type { Db } from "../storage/db.js";
import { callB24 } from "./rest.js";

export type BitrixListInfo = { IBLOCK_ID: string; IBLOCK_TYPE_ID: string; NAME: string };
export type BitrixListElement = { ID: string; NAME: string; SORT?: string };

/** IBLOCK_TYPE_ID values "Универсальные списки" is commonly registered under, in the order we try them. */
const CANDIDATE_IBLOCK_TYPES = ["lists", "bitrix_processes", "lists_socnet"];

/** Enumerates the portal's "Списки" (universal lists) across the common iblock types, so an admin can pick one. */
export async function discoverLists(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string },
): Promise<BitrixListInfo[]> {
  const found: BitrixListInfo[] = [];
  for (const iblockTypeId of CANDIDATE_IBLOCK_TYPES) {
    const res = await callB24<BitrixListInfo[]>(db, {
      domain: ctx.domain,
      memberId: ctx.memberId,
      accessToken: ctx.accessToken,
      method: "lists.get",
      body: { IBLOCK_TYPE_ID: iblockTypeId },
    });
    if (res.ok && Array.isArray(res.result)) {
      for (const item of res.result) found.push({ ...item, IBLOCK_TYPE_ID: iblockTypeId });
    }
  }
  return found;
}

/** Pulls every element (row) of a given list, e.g. the company's canonical city directory. */
export async function fetchListElements(
  db: Db,
  ctx: { domain: string; memberId: string; accessToken: string; iblockTypeId: string; iblockId: string },
): Promise<BitrixListElement[]> {
  const res = await callB24<BitrixListElement[]>(db, {
    domain: ctx.domain,
    memberId: ctx.memberId,
    accessToken: ctx.accessToken,
    method: "lists.element.get",
    body: { IBLOCK_TYPE_ID: ctx.iblockTypeId, IBLOCK_ID: ctx.iblockId },
  });
  if (!res.ok) return [];
  return res.result;
}
