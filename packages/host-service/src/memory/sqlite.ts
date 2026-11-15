export type SqlValue = string | number | null;
export interface MemorySqlite {
	exec(sql: string): unknown;
	prepare(sql: string): {
		get(...values: SqlValue[]): unknown;
		all(...values: SqlValue[]): unknown[];
		run(...values: SqlValue[]): unknown;
	};
}
export function atomic<T>(db: MemorySqlite, fn: () => T): T {
	db.exec("SAVEPOINT memory_write");
	try {
		const result = fn();
		db.exec("RELEASE memory_write");
		return result;
	} catch (error) {
		db.exec("ROLLBACK TO memory_write");
		db.exec("RELEASE memory_write");
		throw error;
	}
}
