import type { Db } from "../storage/db.js";
import { callB24, callB24Webhook, type B24CallResult } from "./rest.js";

export type BitrixListInfo = { IBLOCK_ID: string; IBLOCK_TYPE_ID: string; NAME: string };
export type BitrixListElement = { ID: string; NAME: string; SORT?: string };

/** IBLOCK_TYPE_ID values "Универсальные списки" is commonly registered under, in the order we try them. */
const CANDIDATE_IBLOCK_TYPES = ["lists", "bitrix_processes", "lists_socnet"];

type ListsCtx = { domain: string; memberId: string; accessToken: string; webhookUrl?: string };

// `lists.*` needs the same scope this portal only offers to incoming webhooks, not local
// apps (see setup.ts's ensurePlacement) — route through one when configured.
function callLists<T>(db: Db, ctx: ListsCtx, method: string, body: Record<string, unknown>): Promise<B24CallResult<T>> {
  if (ctx.webhookUrl) return callB24Webhook<T>(ctx.webhookUrl, method, body);
  return callB24<T>(db, { domain: ctx.domain, memberId: ctx.memberId, accessToken: ctx.accessToken, method, body });
}

/** Enumerates the portal's "Списки" (universal lists) across the common iblock types, so an admin can pick one. */
export async function discoverLists(db: Db, ctx: ListsCtx): Promise<BitrixListInfo[]> {
  const found: BitrixListInfo[] = [];
  for (const iblockTypeId of CANDIDATE_IBLOCK_TYPES) {
    const res = await callLists<BitrixListInfo[]>(db, ctx, "lists.get", { IBLOCK_TYPE_ID: iblockTypeId });
    if (res.ok && Array.isArray(res.result)) {
      for (const item of res.result) found.push({ ...item, IBLOCK_TYPE_ID: iblockTypeId });
    }
  }
  return found;
}

/** Pulls every element (row) of a given list, e.g. the company's canonical city directory. */
export async function fetchListElements(
  db: Db,
  ctx: ListsCtx & { iblockTypeId: string; iblockId: string },
): Promise<BitrixListElement[]> {
  const res = await callLists<BitrixListElement[]>(db, ctx, "lists.element.get", {
    IBLOCK_TYPE_ID: ctx.iblockTypeId,
    IBLOCK_ID: ctx.iblockId,
  });
  if (!res.ok) return [];
  return res.result;
}
