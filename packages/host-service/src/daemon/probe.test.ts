import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@jedv/pty-daemon";
import {
	findMacosDaemonJob,
	launchMacosDaemon,
	releaseMacosDaemonJob,
} from "./macos-launch";
import { probeDaemonHello } from "./probe";

test.each([
	undefined,
	"b".repeat(32),
	"a".repeat(32),
])("only the matching hello generation recovers a lost kickstart reply: %s", async (observedGeneration) => {
	const directory = mkdtempSync(join(tmpdir(), "jedv-launch-probe-"));
	const socketPath = join(directory, "daemon.sock");
	const server = new Server({
		socketPath,
		daemonVersion: "test",
		launchdGeneration: observedGeneration,
	});
	const calls: string[][] = [];
	const options = {
		directory,
		socketPath,
		executable: "/fixture/node",
		scriptPath: "/fixture/daemon.js",
		bufferBytes: 1024,
		logPath: join(directory, "daemon.log"),
		env: {},
		uid: 501,
	};
	try {
		await expect(
			launchMacosDaemon(options, {
				generation: () => "a".repeat(32),
				isAlive: () => false,
				isSocketLive: async () => false,
				run: async (args) => {
					calls.push(args);
					if (args[0] === "kickstart") {
						// The daemon is real; only the external launcher's reply is lost.
						await server.listen();
						throw new Error("Host exited before saving the kickstart reply");
					}
					return { code: 0, stdout: "", stderr: "" };
				},
			}),
		).rejects.toThrow("Host exited");
		const probe = await probeDaemonHello(socketPath, 1_000);
		expect(probe?.daemonPid).toBe(process.pid);
		expect(probe?.launchdGeneration).toBe(observedGeneration);
		const job = findMacosDaemonJob(
			directory,
			501,
			process.pid,
			probe?.launchdGeneration,
		);
		if (observedGeneration === "a".repeat(32)) {
			expect(job?.generation).toBe(observedGeneration);
			if (!job) throw new Error("matching generation did not recover the job");
			await server.close();
			expect(
				await releaseMacosDaemonJob(options, job, process.pid, {
					isAlive: () => false,
					isSocketLive: async () => false,
					run: async (args) => {
						calls.push(args);
						return { code: 0, stdout: "", stderr: "" };
					},
				}),
			).toBe(true);
		} else {
			expect(job).toBeUndefined();
			expect(findMacosDaemonJob(directory, 501, process.pid)).toBeUndefined();
		}
		expect(calls.filter((args) => args[0] === "bootstrap")).toHaveLength(1);
	} finally {
		await server.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
