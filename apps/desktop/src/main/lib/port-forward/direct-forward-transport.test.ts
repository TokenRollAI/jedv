import { describe, expect, test } from "bun:test";
import { DirectForwardTransport } from "./direct-forward-transport";

const target = {
	hostUrl: "https://logical-host.invalid",
	workspaceId: "workspace",
	remotePort: 3000,
};

describe("direct forward configuration", () => {
	test("requires an explicit endpoint and host credential", async () => {
		const missing = new DirectForwardTransport({ resolveEndpoint: () => null });
		await expect(missing.probe(target)).rejects.toThrow("not configured");
		const empty = new DirectForwardTransport({
			resolveEndpoint: () => ({ baseUrl: "https://host.invalid", token: "" }),
		});
		await expect(empty.probe(target)).rejects.toThrow("credential is required");
	});

	test("rejects unsafe origins without dialing or exposing credentials", async () => {
		for (const baseUrl of [
			"bad-url",
			"ws://host.invalid",
			"https://user:secret@host.invalid",
			"https://host.invalid/prefix",
			"https://host.invalid?token=secret",
			"https://host.invalid/#secret",
			"http://0.0.0.0:8080",
			"http://[::]:8080",
			"http://100.64.0.1:8080",
		]) {
			const transport = new DirectForwardTransport({
				resolveEndpoint: () => ({ baseUrl, token: "secret" }),
			});
			try {
				await transport.probe(target);
				throw new Error("Expected configuration rejection");
			} catch (error) {
				expect(String(error)).toMatch(
					/Invalid direct|HTTP\(S\) origin|requires HTTPS/,
				);
				expect(String(error)).not.toContain("secret");
			}
		}
	});

	test("rejects invalid workspace and ports before resolving credentials", async () => {
		const transport = new DirectForwardTransport({
			resolveEndpoint: () => {
				throw new Error("Must not resolve");
			},
		});
		await expect(
			transport.probe({ ...target, workspaceId: " " }),
		).rejects.toThrow("Workspace ID");
		for (const remotePort of [0, -1, 65536, 1.5, Number.NaN]) {
			await expect(
				transport.openStream({ ...target, remotePort }),
			).rejects.toThrow("Invalid remote port");
		}
	});

	test("pre-cancelled requests never resolve an endpoint", async () => {
		const transport = new DirectForwardTransport({
			resolveEndpoint: () => {
				throw new Error("Must not resolve");
			},
		});
		await expect(
			transport.probe(target, { signal: AbortSignal.abort() }),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
