import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { AgentSection } from "@/components/landing/agent-section";
import { LandingAnalytics } from "@/components/landing/analytics";
import { CapabilitiesSection } from "@/components/landing/capabilities-section";
import { ClosingCta } from "@/components/landing/closing-cta";
import { Hero } from "@/components/landing/hero";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { ProductShot } from "@/components/landing/product-shot/product-shot";
import { isMarketing } from "@/lib/env";
import { getSession } from "@/lib/session";
import { workspaceHomePath } from "@/lib/workspace-home";

export const metadata: Metadata = {
	title: "The CRM for agents",
	description:
		"The first agentic CRM experience — durable research agents that read your inbox, keep every record current and book their own follow-ups.",
};

export const instant = false;

export default async function Home() {
	await connection();

	const session = await currentSession();

	if (session) {
		redirect(await workspaceHomePath());
	}

	// The proxy only lets an anonymous request reach this page when
	// IS_MARKETING is on. A request that carries a session cookie better-auth
	// rejects (expired, or minted under another name) gets through it, though —
	// that is a visitor who needs the sign-in form, not the marketing page.
	if (!isMarketing()) {
		redirect("/sign-in");
	}

	return (
		<div className="dark flex min-h-svh w-full flex-col items-center overflow-clip bg-background font-sans text-foreground">
			<LandingNav />
			<Hero />
			<ProductShot />
			<AgentSection />
			<CapabilitiesSection />
			<ClosingCta />
			<LandingFooter />
			<LandingAnalytics />
		</div>
	);
}

async function currentSession() {
	try {
		return await getSession();
	} catch (error) {
		unstable_rethrow(error);
		console.error("Landing: could not read the session.", error);
		return null;
	}
}
