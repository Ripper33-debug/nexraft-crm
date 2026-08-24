import { createListSearchParams } from "@/components/data-table/list-search-params";

export const callsSearchParams = createListSearchParams({
	defaultSort: "lastActivity",
	defaultDir: "asc",
	facetIds: ["owner", "industry", "activity"] as const,
});
