import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { workspaceUrl } from "@/lib/workspace-url";

export async function workspaceHomePath(): Promise<string> {
	try {
		const workspace = await getServerQueryClient().fetchQuery(
			getServerTrpc().workspace.get.queryOptions(),
		);

		return workspaceUrl(workspace.slug);
	} catch (error) {
		unstable_rethrow(error);
		console.error("Workspace redirect: could not read the workspace.", error);
		return "/nexraft";
	}
}
