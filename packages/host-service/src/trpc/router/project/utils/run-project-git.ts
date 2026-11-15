import { spawn } from "node:child_process";
import treeKill from "tree-kill";

export async function runProjectGit(
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; signal: AbortSignal },
): Promise<void> {
	options.signal.throwIfAborted();
	await new Promise<void>((resolve, reject) => {
		const child = spawn("git", args, {
			cwd: options.cwd,
			env: options.env,
			detached: process.platform !== "win32",
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		let termination: Promise<void> | undefined;
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (data: string) => {
			stderr = (stderr + data).slice(-1024 * 1024);
		});
		const cancel = () => {
			if (!child.pid || termination) return;
			termination = new Promise<void>((done, fail) => {
				if (process.platform === "win32") {
					treeKill(child.pid as number, "SIGKILL", (error) =>
						error ? fail(error) : done(),
					);
					return;
				}
				try {
					process.kill(-(child.pid as number), "SIGKILL");
					done();
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") done();
					else fail(error);
				}
			});
			void termination.catch(() => {});
		};
		options.signal.addEventListener("abort", cancel, { once: true });
		if (options.signal.aborted) cancel();
		child.once("error", (error) => {
			options.signal.removeEventListener("abort", cancel);
			reject(error);
		});
		child.once("close", async (code) => {
			options.signal.removeEventListener("abort", cancel);
			try {
				await termination;
				options.signal.throwIfAborted();
				if (code !== 0)
					throw new Error(stderr.trim() || `Git exited with code ${code}`);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	});
}
