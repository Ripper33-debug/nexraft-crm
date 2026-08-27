import { SECURE_COOKIE_PREFIX } from "better-auth/cookies";

export const AUTH_COOKIE_PREFIX = "crm";

const SESSION_COOKIE_BASE_NAME = `${AUTH_COOKIE_PREFIX}.session_token`;

/**
 * The name better-auth reads the session token from.
 *
 * With secure cookies on — `advanced.useSecureCookies` in auth.ts, which
 * follows NODE_ENV — better-auth prefixes every cookie it owns with
 * `__Secure-`. Anything that writes the session cookie by hand (the passcode
 * sign-in) has to use the very same name, or the session it just minted is
 * invisible to `auth.api.getSession` in production while `bun run dev` and
 * the test suite carry on working.
 */
export function sessionCookieName(secure: boolean): string {
	return secure
		? `${SECURE_COOKIE_PREFIX}${SESSION_COOKIE_BASE_NAME}`
		: SESSION_COOKIE_BASE_NAME;
}

export const SESSION_COOKIE_NAME = sessionCookieName(
	process.env.NODE_ENV === "production",
);
