import { afterEach, describe, expect, it } from "bun:test";
import {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
} from "../src/workspace";

const originalAllowedSignIn = process.env.ALLOWED_SIGN_IN;

afterEach(() => {
	if (originalAllowedSignIn === undefined) {
		delete process.env.ALLOWED_SIGN_IN;
		return;
	}

	process.env.ALLOWED_SIGN_IN = originalAllowedSignIn;
});

describe("workspace sign-in allow list", () => {
	it("requires an allow-list before anyone can sign in", () => {
		process.env.ALLOWED_SIGN_IN = "";

		expect(hasSignInAllowList()).toBe(false);
		expect(isWorkspaceEmail("rep@nexraft.com")).toBe(false);
	});

	it("allows the exact configured email domain", () => {
		process.env.ALLOWED_SIGN_IN = "nexraft.com";

		expect(hasSignInAllowList()).toBe(true);
		expect(primaryWorkspaceDomain()).toBe("nexraft.com");
		expect(isWorkspaceEmail("rep@nexraft.com")).toBe(true);
		expect(isWorkspaceEmail("  REP@NEXRAFT.COM  ")).toBe(true);
	});

	it("does not allow subdomains of the configured email domain", () => {
		process.env.ALLOWED_SIGN_IN = "nexraft.com";

		expect(isWorkspaceEmail("rep@mail.nexraft.com")).toBe(false);
	});

	it("still allows individual outside addresses when listed", () => {
		process.env.ALLOWED_SIGN_IN = "nexraft.com,contractor@example.com";

		expect(isWorkspaceEmail("contractor@example.com")).toBe(true);
		expect(isWorkspaceEmail("someone@example.com")).toBe(false);
	});
});
