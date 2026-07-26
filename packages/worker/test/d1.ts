import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// Loaded through `createRequire` rather than a static import: Vite's resolver
// does not know `node:sqlite` as a built-in and tries to fetch it from disk.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      get(...params: never[]): unknown;
      all(...params: never[]): unknown[];
      run(...params: never[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
  };
};

/**
 * A D1-compatible facade over an in-memory SQLite database.
 *
 * D1 *is* SQLite, so running the real schema and the real statements against a
 * real engine tests what a hand-written mock cannot: that the SQL is valid,
 * that `ON CONFLICT … WHERE` actually guards the quota, and that a duplicate
 * webhook id really does raise a constraint error.
 */
export function createTestD1(schemaPath: string): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(schemaPath, 'utf8'));

  const prepare = (sql: string): D1PreparedStatement => {
    let params: unknown[] = [];

    const statement: D1PreparedStatement = {
      bind(...values: unknown[]) {
        params = values;
        return statement;
      },
      async first<T>(column?: string) {
        const row = sqlite.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
        if (row === undefined) return null as T;
        const plain = { ...row } as Record<string, unknown>;
        return (column ? (plain[column] as T) : (plain as T)) ?? (null as T);
      },
      async run() {
        const result = sqlite.prepare(sql).run(...(params as never[]));
        return {
          success: true,
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        } as unknown as D1Response;
      },
      async all<T>() {
        const rows = sqlite.prepare(sql).all(...(params as never[])) as T[];
        return { success: true, results: rows.map((row) => ({ ...row })), meta: {} } as unknown as D1Result<T>;
      },
      async raw() {
        return [] as unknown as never;
      },
    } as unknown as D1PreparedStatement;

    return statement;
  };

  return { prepare } as unknown as D1Database;
}

/**
 * Path to the production schema.
 *
 * Resolved from the working directory rather than `import.meta.url` because
 * `@cloudflare/workers-types` and `@types/node` declare incompatible `URL`
 * types, and `readFileSync` wants Node's. Vitest runs with the package root as
 * the working directory.
 */
export const SCHEMA_PATH = resolve(process.cwd(), 'schema.sql');
