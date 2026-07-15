// Postgres-backed database layer for Nexraft CRM (deployed on Vercel + Supabase).
//
// The rest of the CRM (data.ts, auth.server.ts) was written against Cloudflare
// D1's prepared-statement API: db().prepare(sql).bind(...args).all()/.first()/.run().
// To avoid rewriting every query, this module exposes a tiny adapter with the
// same shape, backed by postgres.js. It also rewrites `?` placeholders to the
// `$1, $2, …` form Postgres expects.
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let _sql: Sql | null = null;

function client(): Sql {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Database is not configured (DATABASE_URL missing).");
  }
  // `prepare: false` is required for Supabase's transaction-mode pooler
  // (pgbouncer), which is what serverless functions should use. SSL is required.
  _sql = postgres(url, { prepare: false, ssl: "require", max: 1 });
  return _sql;
}

// D1 uses `?` positional placeholders; Postgres uses `$1, $2, …`.
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class Statement {
  private params: unknown[] = [];
  constructor(private readonly text: string) {}

  bind(...args: unknown[]): this {
    this.params = args;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = await client().unsafe(toPg(this.text), this.params as never[]);
    return { results: rows as unknown as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await client().unsafe(toPg(this.text), this.params as never[]);
    return ((rows[0] as unknown as T) ?? null) as T | null;
  }

  async run(): Promise<{ success: true }> {
    await client().unsafe(toPg(this.text), this.params as never[]);
    return { success: true };
  }
}

export function db() {
  return {
    prepare(text: string) {
      return new Statement(text);
    },
  };
}

export function uid(): string {
  return crypto.randomUUID();
}
