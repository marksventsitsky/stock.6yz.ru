import { z } from "zod";
import type { Db } from "../storage/db.js";
import { getPortalAuth, upsertPortalAuth } from "../storage/repo.js";

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number(),
  scope: z.string().optional(),
  member_id: z.string().optional(),
});

export type B24CallResult<T> = { ok: true; result: T } | { ok: false; error: string; errorDescription?: string };

type B24Ok<T> = { result: T; time?: unknown };
type B24Err = { error: string; error_description?: string };
type B24Response<T> = B24Ok<T> | B24Err;

function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const anyErr = e as Error & { cause?: unknown; code?: unknown; errno?: unknown; syscall?: unknown; hostname?: unknown };
  const cause = anyErr.cause;
  const causeObj =
    cause && typeof cause === "object"
      ? {
          name:
            "name" in cause && typeof (cause as { name?: unknown }).name === "string"
              ? (cause as { name: string }).name
              : undefined,
          message:
            "message" in cause && typeof (cause as { message?: unknown }).message === "string"
              ? (cause as { message: string }).message
              : undefined,
          code: "code" in cause ? (cause as { code?: unknown }).code : undefined,
          errno: "errno" in cause ? (cause as { errno?: unknown }).errno : undefined,
          syscall: "syscall" in cause ? (cause as { syscall?: unknown }).syscall : undefined,
          hostname: "hostname" in cause ? (cause as { hostname?: unknown }).hostname : undefined,
        }
      : cause;

  return JSON.stringify(
    {
      name: anyErr.name,
      message: anyErr.message,
      code: anyErr.code,
      errno: anyErr.errno,
      syscall: anyErr.syscall,
      hostname: anyErr.hostname,
      cause: causeObj,
    },
    null,
    2,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectTimeout(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const anyErr = e as Error & { cause?: unknown };
  const cause = anyErr.cause;
  if (!cause || typeof cause !== "object") return false;
  const code = "code" in cause ? (cause as { code?: unknown }).code : undefined;
  return code === "UND_ERR_CONNECT_TIMEOUT";
}

function isErr<T>(x: B24Response<T>): x is B24Err {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as { error?: unknown }).error === "string"
  );
}

export async function callB24<T>(
  db: Db,
  params: {
    domain: string;
    memberId: string;
    accessToken: string;
    method: string;
    body: Record<string, unknown>;
  },
): Promise<B24CallResult<T>> {
  const url = `https://${params.domain}/rest/${params.method}.json`;
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params.body, auth: params.accessToken }),
  };

  let attempt: Response | null = null;
  let lastErr: unknown = null;
  // Retry connect timeouts (undici default is ~10s) within a broader 2-minute window.
  for (let i = 0; i < 6; i++) {
    try {
      attempt = await fetch(url, { ...requestInit, signal: AbortSignal.timeout(120_000) });
      lastErr = null;
      break;
    } catch (e: unknown) {
      lastErr = e;
      if (!isConnectTimeout(e)) break;
      await sleep(250 * Math.pow(2, i));
    }
  }
  if (!attempt) {
    const msg = describeError(lastErr);
    console.error("[b24] fetch_failed", { url, method: params.method, memberId: params.memberId, error: msg });
    return { ok: false, error: "fetch_failed", errorDescription: msg };
  }

  let data: B24Response<T>;
  try {
    data = (await attempt.json()) as B24Response<T>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "invalid_json", errorDescription: msg };
  }
  if (!isErr(data)) return { ok: true, result: data.result };

  if (data.error === "expired_token") {
    const refreshed = await refreshAccessToken(db, params.memberId);
    if (!refreshed.ok) return { ok: false, error: refreshed.error, errorDescription: refreshed.errorDescription };

    const retryInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params.body, auth: refreshed.accessToken }),
    };

    let retry: Response | null = null;
    let lastRetryErr: unknown = null;
    for (let i = 0; i < 6; i++) {
      try {
        retry = await fetch(url, { ...retryInit, signal: AbortSignal.timeout(120_000) });
        lastRetryErr = null;
        break;
      } catch (e: unknown) {
        lastRetryErr = e;
        if (!isConnectTimeout(e)) break;
        await sleep(250 * Math.pow(2, i));
      }
    }
    if (!retry) {
      const msg = describeError(lastRetryErr);
      console.error("[b24] fetch_failed", { url, method: params.method, memberId: params.memberId, error: msg });
      return { ok: false, error: "fetch_failed", errorDescription: msg };
    }

    let retryData: B24Response<T>;
    try {
      retryData = (await retry.json()) as B24Response<T>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: "invalid_json", errorDescription: msg };
    }
    if (!isErr(retryData)) return { ok: true, result: retryData.result };
    return { ok: false, error: retryData.error, errorDescription: retryData.error_description };
  }

  return { ok: false, error: data.error, errorDescription: data.error_description };
}

async function refreshAccessToken(
  db: Db,
  memberId: string,
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; error: string; errorDescription?: string }
> {
  const auth = getPortalAuth(db, memberId);
  if (!auth?.refreshToken) return { ok: false, error: "no_refresh_token" };
  const clientId = process.env.B24_CLIENT_ID;
  const clientSecret = process.env.B24_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, error: "missing_oauth_config" };

  const url = new URL("https://oauth.bitrix.info/oauth/token/");
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("refresh_token", auth.refreshToken);

  const resp = await fetch(url.toString(), { method: "GET", signal: AbortSignal.timeout(120_000) });
  const json = await resp.json();
  if (!resp.ok) {
    return { ok: false, error: "refresh_failed", errorDescription: JSON.stringify(json) };
  }
  const parsed = RefreshResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "refresh_invalid_response" };

  const expiresAtMs = Date.now() + parsed.data.expires_in * 1000;
  upsertPortalAuth(db, {
    memberId,
    domain: auth.domain,
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? auth.refreshToken,
    expiresAtMs,
  });

  return { ok: true, accessToken: parsed.data.access_token };
}

