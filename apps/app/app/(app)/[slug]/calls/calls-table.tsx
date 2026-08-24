"use client";

import Phone from "@carbon/icons-react/es/Phone";
import { Button } from "@crm/ui/components/button";
import {
	DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { OwnerCell } from "@/components/crm/owner-cell";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { ListSearch } from "@/components/data-table/list-search";
import { SavedViewsMenu } from "@/components/data-table/saved-views-menu";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { LocalRelativeTime } from "@/components/local-date-time";
import { ACTIVITY_FACET_OPTIONS } from "@/lib/activity-recency";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { callsSearchParams } from "./calls-search-params";

type CompanyRow = RouterOutputs["companies"]["list"]["rows"][number];
type CallTarget = {
	label: string | null;
	phone: string | null;
};

function contactName(contact: CompanyRow["primaryContact"]): string | null {
	if (!contact) return null;
	const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
	return name || contact.email || null;
}

function callTarget(row: CompanyRow): CallTarget {
	return {
		label: contactName(row.primaryContact) ?? row.email,
		phone: row.primaryContact?.phone ?? row.phone,
	};
}

const COLUMNS: DataTableColumn<CompanyRow>[] = [
	{
		id: "name",
		header: "Account",
		sortable: true,
		hideable: false,
		width: "w-[24%]",
		cell: (row) => (
			<span className="flex min-w-0 items-center gap-2.5">
				<EntityLogo
					src={row.iconUrl ?? row.logoUrl}
					darkSrc={row.iconDarkUrl}
					tone={row.iconTone as EntityLogoTone | null | undefined}
					name={row.name}
					size="sm"
				/>
				<span className="truncate font-medium">{row.name}</span>
			</span>
		),
	},
	{
		id: "primaryContact",
		header: "Contact",
		width: "w-[20%]",
		cell: (row) => {
			const target = callTarget(row);
			if (!target.label) return <EmptyCellValue />;
			return (
				<span className="flex min-w-0 flex-col">
					<span className="truncate">{target.label}</span>
					{row.primaryContact?.title ? (
						<span className="truncate text-muted-foreground text-xs">
							{row.primaryContact.title}
						</span>
					) : null}
				</span>
			);
		},
	},
	{
		id: "phone",
		header: "Phone",
		width: "w-[15%]",
		hideBelow: "sm",
		cell: (row) => {
			const target = callTarget(row);
			if (!target.phone) return <EmptyCellValue />;
			return (
				<a
					href={`tel:${target.phone}`}
					className="truncate text-foreground underline-offset-2 hover:underline"
					onClick={(event) => event.stopPropagation()}
				>
					{target.phone}
				</a>
			);
		},
	},
	{
		id: "owner",
		header: "Owner",
		sortable: true,
		width: "w-[14%]",
		hideBelow: "md",
		cell: (row) => <OwnerCell owner={row.owner} />,
	},
	{
		id: "openDeals",
		header: "Open deals",
		sortable: true,
		align: "right",
		width: "w-[10%]",
		cell: (row) => <span className="tabular-nums">{row.openDealCount}</span>,
	},
	{
		id: "lastActivity",
		header: "Last touch",
		sortable: true,
		align: "right",
		width: "w-[12%]",
		cell: (row) =>
			row.lastActivityAt ? (
				<span className="text-muted-foreground">
					<LocalRelativeTime date={row.lastActivityAt} />
				</span>
			) : (
				<span className="text-muted-foreground">Never</span>
			),
	},
	{
		id: "call",
		header: "Call",
		label: "Call action",
		align: "right",
		width: "w-14",
		cell: (row) => {
			const phone = callTarget(row).phone;
			if (!phone) {
				return (
					<Button variant="outline" size="icon-xs" disabled>
						<Icon icon={Phone} />
						<span className="sr-only">No phone number for {row.name}</span>
					</Button>
				);
			}

			return (
				<Button
					asChild
					variant="outline"
					size="icon-xs"
					onClick={(event) => event.stopPropagation()}
				>
					<a href={`tel:${phone}`}>
						<Icon icon={Phone} />
						<span className="sr-only">Call {row.name}</span>
					</a>
				</Button>
			);
		},
	},
];

export function CallsTable() {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const prefetchRecord = usePrefetchRecord();
	const table = useTableQuery(callsSearchParams);
	const { query, input } = table;

	const companies = useQuery({
		...trpc.companies.list.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const users = useQuery(trpc.users.list.queryOptions());

	const rows = companies.data?.rows ?? [];
	const facetCounts = companies.data?.facetCounts;

	const facets: DataTableFacet[] = [
		{
			id: "owner",
			label: "Owner",
			options: [
				{ value: "unassigned", label: "Unassigned" },
				...(users.data ?? []).map((user) => ({
					value: user.id,
					label: user.name,
				})),
			].filter((option) => (facetCounts?.owner?.[option.value] ?? 0) > 0),
		},
		{
			id: "industry",
			label: "Industry",
			options: Object.keys(facetCounts?.industry ?? {})
				.sort()
				.map((value) => ({ value, label: value })),
		},
		{
			id: "activity",
			label: "Activity",
			options: ACTIVITY_FACET_OPTIONS.filter(
				(option) => (facetCounts?.activity?.[option.value] ?? 0) > 0,
			),
		},
	];

	const columns = useMemo(() => COLUMNS, []);

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder="Search accounts to call..." />}
			actions={<SavedViewsMenu entity="COMPANY" table={table} />}
			columns={columns}
			rows={rows}
			total={companies.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			getRowId={(row) => row.id}
			loading={companies.isFetching}
			onRowHover={(row) => prefetchRecord({ kind: "company", id: row.id })}
			onRowClick={(row) => openRecord({ kind: "company", id: row.id })}
			empty="No accounts match this call view."
		/>
	);
}
