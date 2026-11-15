import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCredentialProvider } from "../../../../runtime/git";
import { cloneRepoInto, cloneTemplateInto } from "./resolve-repo";

for (const kind of ["clone", "template"] as const) {
	test(`${kind} abort closes the local Git transfer and rolls back its claimed directory`, async () => {
		const root = mkdtempSync(join(tmpdir(), "jedv-cancel-"));
		const started = Promise.withResolvers<void>();
		const closed = Promise.withResolvers<void>();
		const server = createServer((request) => {
			request.socket.once("close", () => closed.resolve());
			started.resolve();
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing test port");
		const credentials = {
			getCredentials: async () => ({
				env: {
					...process.env,
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_CONFIG_NOSYSTEM: "1",
				},
			}),
		} as unknown as GitCredentialProvider;
		const controller = new AbortController();
		try {
			const url = `http://127.0.0.1:${address.port}/fixture.git`;
			const pending =
				kind === "clone"
					? cloneRepoInto(url, root, credentials, controller.signal)
					: cloneTemplateInto(
							url,
							root,
							"fixture",
							credentials,
							controller.signal,
						);
			const result = pending.then(
				() => false,
				() => true,
			);
			const early = await Promise.race([
				started.promise.then(() => null),
				pending.then(
					() => new Error("Clone unexpectedly completed"),
					(error: unknown) => error,
				),
			]);
			if (early) throw early;
			expect(existsSync(join(root, "fixture"))).toBe(true);
			controller.abort();
			expect(await result).toBe(true);
			await closed.promise;
			expect(existsSync(join(root, "fixture"))).toBe(false);
		} finally {
			controller.abort();
			server.closeAllConnections();
			server.close();
			rmSync(root, { recursive: true, force: true });
		}
	});
}
