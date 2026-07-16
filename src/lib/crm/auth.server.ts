import { getRequest } from "@tanstack/react-start/server";

import { db, uid } from "./db.server";

export type AuthUser = { id: string; email: string; name: string; role: string };

const COOKIE = "nx_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// ---- signup access code (configurable via secret, sensible default) ----
export function signupCode(): string {
  const fromEnv = process.env.NEXRAFT_SIGNUP_CODE;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "nexraft2026";
}

// ---- account owner (always an admin, can never be locked out) ----
// The owner's login email. Configurable via secret; defaults to Barry's.
// Whoever signs in with this address is guaranteed admin — a safety net so
// the business owner is never left without access to their own CRM.
export function ownerEmail(): string {
  const fromEnv = process.env.NEXRAFT_OWNER_EMAIL;
  return (fromEnv && fromEnv.length > 0 ? fromEnv : "barry@nexraft.com").trim().toLowerCase();
}

// ---- cookies ----
function readCookie(name: string): string | null {
  const req = getRequest();
  const header = req?.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ---- sessions ----
export async function createSession(userId: string): Promise<string> {
  const token = toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[^a-zA-Z0-9]/g, "");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db()
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expires)
    .run();
  return token;
}

export async function destroySession(): Promise<void> {
  const token = readCookie(COOKIE);
  if (token) {
    await db().prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
  }
}

export async function currentUser(): Promise<AuthUser | null> {
  const token = readCookie(COOKIE);
  if (!token) return null;
  const row = await db()
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, s.expires_at AS exp
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .bind(token)
    .first<{ id: string; email: string; name: string; role: string; exp: string }>();
  if (!row) return null;
  if (new Date(row.exp).getTime() < Date.now()) {
    await db().prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    return null;
  }
  let role = row.role;
  // Owner safety net: if the account owner ever ends up as a plain member,
  // quietly restore their admin role so they can't be locked out.
  if (role !== "admin" && row.email.trim().toLowerCase() === ownerEmail()) {
    await db().prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(row.id).run();
    role = "admin";
  }
  return { id: row.id, email: row.email, name: row.name, role };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

// ---- registration / login core (used by /api/auth routes) ----
export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
  code: string;
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email || !input.password) return { ok: false, error: "All fields are required." };
  if (input.password.length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };
  if (input.code.trim() !== signupCode())
    return { ok: false, error: "That team access code is not correct." };

  const existing = await db()
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();
  if (existing) return { ok: false, error: "An account with that email already exists." };

  const id = uid();
  const password_hash = await hashPassword(input.password);
  // First user becomes admin.
  const countRow = await db().prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  const role = (countRow?.c ?? 0) === 0 ? "admin" : "member";
  await db()
    .prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)")
    .bind(id, email, name, password_hash, role)
    .run();
  const token = await createSession(id);
  return { ok: true, token };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  const row = await db()
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (!row) return { ok: false, error: "Incorrect email or password." };
  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) return { ok: false, error: "Incorrect email or password." };
  const token = await createSession(row.id);
  return { ok: true, token };
}
