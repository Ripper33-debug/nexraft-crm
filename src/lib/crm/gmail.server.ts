// Gmail sending for reps, via Google OAuth + the Gmail REST API.
//
// Flow: a rep connects their Google Workspace account once (/api/gmail/connect →
// Google consent → /api/gmail/callback). We keep an encrypted refresh token and
// mint short-lived access tokens on demand to send mail as them. Because the whole
// team is on one Workspace domain, the Google Cloud OAuth app is registered as
// "Internal", so no Google verification/security-review is required and only
// @your-domain users can connect.
//
// No googleapis SDK — just fetch against Google's documented endpoints, to keep
// the dependency surface (and the serverless bundle) small.
import { db, uid } from "./db.server";
import { ensureExtraSchema } from "./schema.server";
import { seal, open } from "./crypto.server";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// gmail.send lets us send but NOT read the mailbox — the least-privilege scope
// for outreach. openid+email let us learn which address they connected.
const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];

export function isGmailConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_TOKEN_SECRET);
}

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID is not set.");
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET is not set.");
  return v;
}
// Restrict consent to the company's Workspace domain when configured, so a rep
// can't accidentally connect a personal @gmail.com account.
function hostedDomain(): string | null {
  const v = (process.env.GOOGLE_WORKSPACE_DOMAIN || "").trim();
  return v || null;
}

// The public base URL of the app, used to build the OAuth redirect URI. Prefer
// an explicit env (must match what's registered in Google Cloud exactly); else
// reconstruct from the incoming request (honoring Vercel's forwarded headers).
export function baseUrlFrom(request: Request): string {
  const fromEnv = (process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const h = request.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host;
  return `${proto}://${host}`;
}

export function redirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/gmail/callback`;
}

// Build the Google consent URL. `state` ties the callback back to this session.
export function authUrl(baseUrl: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(baseUrl),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // needed to receive a refresh token
    prompt: "consent", // force a refresh token even on re-consent
    include_granted_scopes: "true",
    state,
  });
  const hd = hostedDomain();
  if (hd) p.set("hd", hd);
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

// The id_token is a JWT from Google over TLS; we only need the email claim, so a
// plain payload decode (no signature check) is sufficient here.
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status}).`);
  }
  return data;
}

// Exchange the one-time auth code for tokens and persist the connection.
export async function connectFromCode(userId: string, code: string, baseUrl: string): Promise<{ email: string }> {
  const tok = await postToken({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(baseUrl),
    grant_type: "authorization_code",
  });
  if (!tok.refresh_token) {
    // Happens if the account was connected before without prompt=consent; the
    // caller should have forced consent, so treat as an error worth surfacing.
    throw new Error("Google did not return a refresh token — disconnect and try again.");
  }
  const email = emailFromIdToken(tok.id_token) ?? "";
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();

  await ensureExtraSchema();
  const sealedRefresh = await seal(tok.refresh_token);
  const sealedAccess = await seal(tok.access_token);
  await db()
    .prepare(
      `INSERT INTO gmail_connections (user_id, email, refresh_token, access_token, token_expires_at, scope, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         refresh_token = EXCLUDED.refresh_token,
         access_token = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         scope = EXCLUDED.scope,
         updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    )
    .bind(userId, email, sealedRefresh, sealedAccess, expiresAt, tok.scope ?? SCOPES.join(" "))
    .run();
  return { email };
}

type ConnRow = {
  email: string;
  refresh_token: string;
  access_token: string | null;
  token_expires_at: string | null;
};

// Return a currently-valid access token for the user, refreshing if needed.
async function getValidAccessToken(userId: string): Promise<{ accessToken: string; email: string }> {
  await ensureExtraSchema();
  const row = await db()
    .prepare(
      `SELECT email, refresh_token, access_token, token_expires_at FROM gmail_connections WHERE user_id = ?`,
    )
    .bind(userId)
    .first<ConnRow>();
  if (!row) throw new Error("No Gmail account connected. Connect one in Settings first.");

  const stillValid =
    row.access_token && row.token_expires_at && new Date(row.token_expires_at).getTime() > Date.now();
  if (stillValid) {
    return { accessToken: await open(row.access_token as string), email: row.email };
  }

  // Refresh.
  const refreshToken = await open(row.refresh_token);
  const tok = await postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  await db()
    .prepare(
      `UPDATE gmail_connections SET access_token = ?, token_expires_at = ?,
         updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE user_id = ?`,
    )
    .bind(await seal(tok.access_token), expiresAt, userId)
    .run();
  return { accessToken: tok.access_token, email: row.email };
}

export async function getConnection(userId: string): Promise<{ connected: boolean; email: string | null }> {
  await ensureExtraSchema();
  const row = await db()
    .prepare(`SELECT email FROM gmail_connections WHERE user_id = ?`)
    .bind(userId)
    .first<{ email: string }>();
  return { connected: !!row, email: row?.email ?? null };
}

export async function disconnect(userId: string): Promise<void> {
  await ensureExtraSchema();
  await db().prepare(`DELETE FROM gmail_connections WHERE user_id = ?`).bind(userId).run();
}

// ---- MIME + base64url helpers ----
const enc = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// RFC 2047 encode a header value if it has non-ASCII characters (e.g. accents).
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(String.fromCharCode(...enc.encode(value)))}?=`;
}

function buildRawMessage(opts: {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const from = `${encodeHeader(opts.fromName)} <${opts.fromEmail}>`;
  const headers = [
    `From: ${from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  const raw = `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
  return base64url(enc.encode(raw));
}

// Optional CAN-SPAM-style footer appended to every sent message: a real mailing
// address and a plain opt-out. Configure the address via env; if unset we still
// include a reply-based opt-out line.
function complianceFooter(): string {
  const addr = (process.env.NEXRAFT_MAILING_ADDRESS || "").trim();
  const lines = ["", "—", "Nexraft"];
  if (addr) lines.push(addr);
  lines.push("Prefer not to hear from us? Reply with \"unsubscribe\" and we'll take you off our list.");
  return lines.join("\n");
}

export async function sendEmail(opts: {
  userId: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  companyId?: string | null;
  contactId?: string | null;
  appendFooter?: boolean;
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  try {
    const { accessToken, email } = await getValidAccessToken(opts.userId);
    const body = opts.appendFooter === false ? opts.body : `${opts.body}\n${complianceFooter()}`;
    const raw = buildRawMessage({
      fromName: opts.fromName,
      fromEmail: email,
      to: opts.to,
      subject: opts.subject,
      body,
    });
    const res = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    const data = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok) {
      return { ok: false, error: data.error?.message || `Gmail send failed (${res.status}).` };
    }
    const messageId = data.id ?? null;
    // Record the send (best-effort — never fail the send over a log write).
    try {
      await db()
        .prepare(
          `INSERT INTO sent_emails (id, sender_id, company_id, contact_id, to_email, subject, gmail_message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(uid(), opts.userId, opts.companyId ?? null, opts.contactId ?? null, opts.to, opts.subject, messageId)
        .run();
    } catch {
      /* non-critical */
    }
    return { ok: true, messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}
