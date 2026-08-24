import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { callsSearchParams } from "./calls-search-params";
import { CallsTable } from "./calls-table";

export const metadata: Metadata = {
	title: "Calls",
};

export default function CallsPage({
	searchParams,
}: PageProps<"/[slug]/calls">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Calls</PageShellTitle>
					<PageShellDescription>
						Nexraft's sales call queue, built on the account book.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<Calls searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Calls({
	searchParams,
}: Pick<PageProps<"/[slug]/calls">, "searchParams">) {
	const [, values] = await Promise.all([
		requireSession(),
		callsSearchParams.load(searchParams),
	]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await Promise.all([
		queryClient.prefetchQuery(
			trpc.companies.list.queryOptions(callsSearchParams.toInput(values)),
		),
		queryClient.prefetchQuery(trpc.users.list.queryOptions()),
	]);

	return (
		<HydrateClient>
			<CallsTable />
		</HydrateClient>
	);
}
