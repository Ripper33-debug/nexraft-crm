const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function databaseSchema(): string | undefined {
	const schema = process.env.DATABASE_SCHEMA?.trim();
	if (!schema) return undefined;

	if (!POSTGRES_IDENTIFIER.test(schema)) {
		throw new Error(
			"DATABASE_SCHEMA must be an unquoted PostgreSQL identifier, like nexraft_crm_app.",
		);
	}

	return schema;
}

export function databaseUrlWithSchema(url: string): string {
	const schema = databaseSchema();
	if (!schema) return url;

	try {
		const parsed = new URL(url);
		parsed.searchParams.set("schema", schema);
		parsed.searchParams.set(
			"options",
			withSearchPathOption(parsed.searchParams.get("options"), schema),
		);
		return parsed.toString();
	} catch {
		return url;
	}
}

function withSearchPathOption(options: string | null, schema: string): string {
	const searchPathOption = `-c search_path=${schema},public`;
	const existingOptions = options?.trim();

	if (!existingOptions) {
		return searchPathOption;
	}

	return `${existingOptions} ${searchPathOption}`;
}
