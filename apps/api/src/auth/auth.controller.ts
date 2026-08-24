import { type auth, SESSION_COOKIE_NAME } from "@crm/auth";
import {
	BadRequestException,
	Controller,
	Get,
	Post,
	Req,
	Res,
} from "@nestjs/common";
import {
	ApiCookieAuth,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
	AllowAnonymous,
	OptionalAuth,
	Session,
	type UserSession,
} from "@thallesp/nestjs-better-auth";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuthService } from "./auth.service";

type CrmSession = UserSession<typeof auth>;

const passcodeInput = z.object({
	passcode: z.string().trim().min(1).max(200),
});

const MAX_PASSCODE_BODY_BYTES = 2048;

@ApiTags("Auth")
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Post("passcode")
	@AllowAnonymous()
	@ApiOperation({ summary: "Sign in with the shared CRM passcode" })
	@ApiOkResponse({ description: "A session cookie was set." })
	@ApiUnauthorizedResponse({ description: "The passcode did not match." })
	@ApiServiceUnavailableResponse({
		description: "Passcode sign-in is not configured.",
	})
	async signInWithPasscode(
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	) {
		const parsed = passcodeInput.safeParse(await readJsonBody(request));

		if (!parsed.success) {
			throw new BadRequestException("Passcode is required.");
		}

		const session = await this.authService.signInWithPasscode({
			passcode: parsed.data.passcode,
			ipAddress: clientIp(request),
			userAgent: request.get("user-agent"),
		});

		response.setHeader("Set-Cookie", session.cookie);

		return {
			authenticated: true,
			user: session.user,
			expiresAt: session.expiresAt.toISOString(),
		};
	}

	@Get("me")
	@ApiOperation({ summary: "Get the signed-in user's profile" })
	@ApiOkResponse({ description: "The signed-in user's profile." })
	@ApiUnauthorizedResponse({ description: "No valid session." })
	async getMe(@Session() session: CrmSession) {
		return { user: await this.authService.getProfile(session.user.id) };
	}

	@Get("session")
	@OptionalAuth()
	@ApiOperation({
		summary: "Check whether the current request carries a valid session",
	})
	@ApiOkResponse({
		description: "Whether the request is authenticated, and as whom.",
	})
	getSession(@Session() session?: CrmSession) {
		if (!session) {
			return { authenticated: false, user: null };
		}

		return {
			authenticated: true,
			user: { id: session.user.id, email: session.user.email },
			expiresAt: session.session.expiresAt,
		};
	}
}

async function readJsonBody(request: Request): Promise<unknown> {
	const parsed = (request as Request & { body?: unknown }).body;
	if (parsed !== undefined) {
		return typeof parsed === "string" || Buffer.isBuffer(parsed)
			? parseJsonBody(String(parsed))
			: parsed;
	}

	let raw = "";

	for await (const chunk of request) {
		raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);

		if (Buffer.byteLength(raw, "utf8") > MAX_PASSCODE_BODY_BYTES) {
			throw new BadRequestException("Request body is too large.");
		}
	}

	return parseJsonBody(raw);
}

function parseJsonBody(raw: string): unknown {
	try {
		return raw.trim() ? JSON.parse(raw) : {};
	} catch {
		throw new BadRequestException("Request body must be valid JSON.");
	}
}

function clientIp(request: Request): string | undefined {
	const forwardedFor = request.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwardedFor || request.ip || undefined;
}
