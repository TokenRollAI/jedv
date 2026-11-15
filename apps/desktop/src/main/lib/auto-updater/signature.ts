import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function verifyMacAppSignature(appPath: string): Promise<boolean> {
	const end = appPath.indexOf(".app/Contents/");
	if (end < 0) return false;
	const bundle = appPath.slice(0, end + 4);
	try {
		await run("/usr/bin/codesign", ["--verify", "--strict", bundle], {
			timeout: 5000,
		});
		const { stderr } = await run(
			"/usr/bin/codesign",
			["--display", "--verbose=2", bundle],
			{ timeout: 5000 },
		);
		return (
			/^TeamIdentifier=[A-Za-z0-9]{10}$/m.test(stderr) &&
			!/Signature=adhoc/.test(stderr)
		);
	} catch {
		return false;
	}
}
