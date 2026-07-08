import { z } from "zod";
import type { Db } from "../storage/db.js";
import { upsertPortalAuth } from "../storage/repo.js";

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.coerce.number(),
  scope: z.string().optional(),
  member_id: z.string(),
  domain: z.string().optional(),
});

export async function exchangeCodeForToken(
  db: Db,
  params: { code: string; serverDomainHint?: string },
): Promise<{ ok: true; memberId: string } | { ok: false; error: string; errorDescription?: string }> {
  const clientId = process.env.B24_CLIENT_ID;
  const clientSecret = process.env.B24_CLIENT_SECRET;
  const redirectUri = process.env.B24_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return { ok: false, error: "missing_oauth_config" };
  }

  const url = new URL("https://oauth.bitrix.info/oauth/token/");
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("code", params.code);
  url.searchParams.set("redirect_uri", redirectUri);

  const resp = await fetch(url.toString(), { method: "GET" });
  const json = await resp.json();
  if (!resp.ok) return { ok: false, error: "token_exchange_failed", errorDescription: JSON.stringify(json) };

  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "token_exchange_invalid_response" };

  const expiresAtMs = Date.now() + parsed.data.expires_in * 1000;
  const domain = parsed.data.domain || params.serverDomainHint || "";
  if (!domain) return { ok: false, error: "missing_domain" };

  upsertPortalAuth(db, {
    memberId: parsed.data.member_id,
    domain,
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAtMs,
  });

  return { ok: true, memberId: parsed.data.member_id };
}

