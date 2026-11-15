import { expect, test } from "bun:test";
import {
	deriveProjectNameFromUrl,
	directoryNameForProject,
	isRepositorySource,
	joinProjectPath,
	redactProjectError,
} from "./project-utils";

test("repository sources derive the actual clone directory without query credentials", () => {
	expect(
		deriveProjectNameFromUrl(
			"https://user:secret@github.com/owner/repo.git?token=secret",
		),
	).toBe("repo");
	expect(deriveProjectNameFromUrl("git@github.com:owner/repo.git")).toBe(
		"repo",
	);
	expect(isRepositorySource("git@github.com:owner/repo.git")).toBe(true);
	expect(isRepositorySource("/tmp/repository")).toBe(true);
	expect(isRepositorySource("--upload-pack=unsafe")).toBe(false);
	expect(isRepositorySource("https://example.test/repo\n--unsafe")).toBe(false);
	expect(isRepositorySource("javascript:alert(1)")).toBe(false);
	expect(
		isRepositorySource("https://github.com/owner/repo.git?token=secret"),
	).toBe(false);
});
test("preview paths match backend naming for empty and clone modes", () => {
	expect(directoryNameForProject("My Project 中文")).toBe("My-Project-中文");
	expect(joinProjectPath("/tmp/", "repo")).toBe("/tmp/repo");
	expect(joinProjectPath("C:\\Projects\\", "repo")).toBe("C:\\Projects\\repo");
});
test("errors never render URL credentials, query tokens, or common GitHub tokens", () => {
	const error = redactProjectError(
		"git failed https://user:password@host.test/repo?token=secret#fragment github_pat_123456",
	);
	expect(error).toBe("git failed https://host.test/repo [redacted]");
});

test("Unicode directory names match the backend without normalization", () => {
	expect(directoryNameForProject("中文项目")).toBe("中文项目");
	expect(directoryNameForProject("e\u0301")).toBe("e\u0301");
});
