import {
	createHash,
	createHmac,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import {
	ensureWorkspaceMembership,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
	SESSION_COOKIE_NAME,
} from "@crm/auth";
import type { Db } from "@crm/db";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import type { Cache } from "cache-manager";
import { InjectDatabase } from "../database/database.constants";

export interface UserProfile {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: string;
}

const PROFILE_TTL_MS = 5 * 60_000;
const PASSCODE_ATTEMPT_TTL_MS = 15 * 60_000;
const PASSCODE_MAX_ATTEMPTS = 10;
const PASSCODE_SESSION_DAYS = 7;
const PASSCODE_SESSION_SECONDS = PASSCODE_SESSION_DAYS * 24 * 60 * 60;

const profileKey = (userId: string) => `auth:profile:${userId}`;
const passcodeAttemptKey = (ipAddress: string) =>
	`auth:passcode-attempts:${ipAddress}`;

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(CACHE_MANAGER) private readonly cache: Cache,
	) {}

	async getProfile(userId: string): Promise<UserProfile> {
		const key = profileKey(userId);
		const cached = await this.cache.get<UserProfile>(key);

		if (cached) {
			return cached;
		}

		this.logger.debug({ message: "Profile cache miss", userId });

		const user = await this.db.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				name: true,
				email: true,
				emailVerified: true,
				image: true,
				createdAt: true,
			},
		});

		if (!user) {
			this.logger.warn({ message: "Session user no longer exists", userId });
			throw new NotFoundException(`No user with id ${userId}.`);
		}

		const profile: UserProfile = {
			...user,
			createdAt: user.createdAt.toISOString(),
		};

		await this.cache.set(key, profile, PROFILE_TTL_MS);

		return profile;
	}

	async invalidateProfile(userId: string): Promise<void> {
		await this.cache.del(profileKey(userId));
		this.logger.debug({ message: "Invalidated cached profile", userId });
	}

	async signInWithPasscode(input: {
		passcode: string;
		ipAddress?: string;
		userAgent?: string;
	}): Promise<{
		user: { id: string; email: string };
		expiresAt: Date;
		cookie: string;
	}> {
		const expected = configuredPasscode();

		if (!expected) {
			throw new ServiceUnavailableException(
				"CRM passcode sign-in is not set up.",
			);
		}

		const ipAddress = input.ipAddress ?? "unknown";
		await this.assertPasscodeNotLocked(ipAddress);

		if (!passcodeMatches(input.passcode.trim(), expected)) {
			await this.recordFailedPasscode(ipAddress);
			throw new UnauthorizedException("That passcode did not work.");
		}

		await this.cache.del(passcodeAttemptKey(ipAddress));

		const email = passcodeUserEmail();
		if (!isWorkspaceEmail(email)) {
			throw new ServiceUnavailableException(
				"CRM passcode sign-in user is not allowed by ALLOWED_SIGN_IN.",
			);
		}

		const user = await this.db.user.upsert({
			where: { email },
			create: {
				id: passcodeUserId(email),
				email,
				name: "Nexraft CRM",
				emailVerified: true,
				updatedAt: new Date(),
			},
			update: {
				emailVerified: true,
				updatedAt: new Date(),
			},
			select: { id: true, email: true },
		});

		const workspaceId = await ensureWorkspaceMembership(user.id);
		const token = randomBytes(32).toString("hex");
		const expiresAt = new Date(Date.now() + PASSCODE_SESSION_SECONDS * 1000);

		await this.db.session.create({
			data: {
				id: randomUUID(),
				token,
				userId: user.id,
				expiresAt,
				ipAddress,
				userAgent: input.userAgent,
				activeOrganizationId: workspaceId ?? null,
				updatedAt: new Date(),
			},
		});

		return {
			user,
			expiresAt,
			cookie: sessionCookie(token, expiresAt),
		};
	}

	private async assertPasscodeNotLocked(ipAddress: string): Promise<void> {
		const attempts = await this.failedPasscodeAttempts(ipAddress);

		if (attempts >= PASSCODE_MAX_ATTEMPTS) {
			throw new HttpException(
				"Too many passcode attempts. Try again soon.",
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}
	}

	private async recordFailedPasscode(ipAddress: string): Promise<void> {
		const attempts = await this.failedPasscodeAttempts(ipAddress);
		await this.cache.set(
			passcodeAttemptKey(ipAddress),
			attempts + 1,
			PASSCODE_ATTEMPT_TTL_MS,
		);
	}

	private async failedPasscodeAttempts(ipAddress: string): Promise<number> {
		const attempts = Number(
			await this.cache.get<number>(passcodeAttemptKey(ipAddress)),
		);
		return Number.isFinite(attempts) ? attempts : 0;
	}
}

function configuredPasscode(): string | undefined {
	const value = process.env.CRM_PASSCODE?.trim();
	return value ? value : undefined;
}

function passcodeUserEmail(): string {
	const configured = process.env.CRM_PASSCODE_EMAIL?.trim().toLowerCase();
	if (configured) return configured;

	const domain = primaryWorkspaceDomain();
	return `crm@${domain ?? "nexraft.com"}`;
}

function passcodeUserId(email: string): string {
	return `passcode-${createHash("sha256").update(email).digest("hex").slice(0, 24)}`;
}

function passcodeMatches(candidate: string, expected: string): boolean {
	const left = createHash("sha256").update(candidate).digest();
	const right = createHash("sha256").update(expected).digest();
	return timingSafeEqual(left, right);
}

function sessionCookie(token: string, expiresAt: Date): string {
	const value = signCookieValue(token);
	const parts = [
		`${SESSION_COOKIE_NAME}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${PASSCODE_SESSION_SECONDS}`,
		`Expires=${expiresAt.toUTCString()}`,
	];

	if (process.env.NODE_ENV === "production") parts.push("Secure");

	const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
	if (domain) parts.push(`Domain=${domain}`);

	return parts.join("; ");
}

function signCookieValue(value: string): string {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new ServiceUnavailableException("CRM auth secret is not set.");
	}

	const signature = createHmac("sha256", secret).update(value).digest("base64");
	return encodeURIComponent(`${value}.${signature}`);
}
