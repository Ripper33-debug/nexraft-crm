import { describe, expect, it } from "bun:test";
import { createCookieGetter } from "better-auth/cookies";
import { AUTH_COOKIE_PREFIX, sessionCookieName } from "../src/cookies";

// better-auth decides the cookie name from `advanced.useSecureCookies`, and
// auth.ts sets that flag to `env.isProduction`. The passcode sign-in writes the
// session cookie by hand, so its name has to track the same rule — this pins
// the derivation to better-auth's own `createCookieGetter`.
function betterAuthSessionCookieName(useSecureCookies: boolean): string {
	return createCookieGetter({
		advanced: { cookiePrefix: AUTH_COOKIE_PREFIX, useSecureCookies },
	})("session_token").name;
}

describe("session cookie name", () => {
	it("matches better-auth when secure cookies are off (dev, test)", () => {
		expect(sessionCookieName(false)).toBe("crm.session_token");
		expect(sessionCookieName(false)).toBe(betterAuthSessionCookieName(false));
	});

	it("matches better-auth when secure cookies are on (production)", () => {
		expect(sessionCookieName(true)).toBe("__Secure-crm.session_token");
		expect(sessionCookieName(true)).toBe(betterAuthSessionCookieName(true));
	});
});
