import { expect, test } from "bun:test";
import { resolveWorkspaceFilePath } from "./workspace-path";

test("quick open and Changes resolve relative files at the workspace root without crossing filesystem boundaries", () => {
	const root = "/private/tmp/jedv-parity-ui-project";
	expect(resolveWorkspaceFilePath(root, "smoke.txt")).toBe(`${root}/smoke.txt`);
	expect(resolveWorkspaceFilePath(root, "src/changed.ts")).toBe(
		`${root}/src/changed.ts`,
	);
	expect(resolveWorkspaceFilePath(root, "./smoke.txt")).toBe(
		`${root}/smoke.txt`,
	);
	expect(resolveWorkspaceFilePath(root, `${root}/smoke.txt`)).toBe(
		`${root}/smoke.txt`,
	);
	for (const path of [
		"../outside.txt",
		"src/../../outside.txt",
		"/outside.txt",
		`${root}-other/smoke.txt`,
		"/tmp/jedv-parity-ui-project/smoke.txt",
		"D:\\repo\\smoke.txt",
		"C:smoke.txt",
		"\\rooted.txt",
		"\\\\other\\share\\smoke.txt",
	])
		expect(resolveWorkspaceFilePath(root, path)).toBeNull();
	expect(resolveWorkspaceFilePath("C:\\repo", "src/changed.ts")).toBe(
		"C:\\repo/src/changed.ts",
	);
	expect(resolveWorkspaceFilePath("C:\\repo", "C:\\repo\\smoke.txt")).toBe(
		"C:\\repo\\smoke.txt",
	);
	for (const path of [
		"D:\\repo\\smoke.txt",
		"C:smoke.txt",
		"C:\\repo-other\\smoke.txt",
		"..\\outside.txt",
		"\\\\server\\share\\smoke.txt",
	])
		expect(resolveWorkspaceFilePath("C:\\repo", path)).toBeNull();
	const share = "\\\\server\\share\\repo";
	expect(resolveWorkspaceFilePath(share, "smoke.txt")).toBe(
		`${share}/smoke.txt`,
	);
	expect(resolveWorkspaceFilePath(share, `${share}\\smoke.txt`)).toBe(
		`${share}\\smoke.txt`,
	);
	for (const path of [
		"\\\\other\\share\\repo\\smoke.txt",
		"\\\\server\\other\\repo\\smoke.txt",
		"\\\\server\\share\\repo-other\\smoke.txt",
		"/server/share/repo/smoke.txt",
	])
		expect(resolveWorkspaceFilePath(share, path)).toBeNull();
});
