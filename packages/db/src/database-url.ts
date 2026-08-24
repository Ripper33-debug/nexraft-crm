export function databaseUrlWithSchema(url: string): string {
	const schema = process.env.DATABASE_SCHEMA?.trim();
	if (!schema) return url;

	try {
		const parsed = new URL(url);
		if (!parsed.searchParams.has("schema")) {
			parsed.searchParams.set("schema", schema);
		}
		return parsed.toString();
	} catch {
		return url;
	}
}
