import { expect, test } from "bun:test";
import { copyPromptAttachments } from "./copy-attachments";

const file = {
	filename: "fixture.txt",
	url: "data:text/plain;base64,aGVsbG8=",
};
function draft() {
	return { paths: new Map<string, string>(), copyUnknown: false };
}
test("a restored attachment reuses its copied path after prompt failure", async () => {
	const state = draft();
	let copies = 0;
	const write = async () => {
		copies++;
		return {
			ok: true as const,
			paths: ["/fixture/.jedv/attachments/fixture.txt"],
		};
	};
	expect(
		await copyPromptAttachments({ files: [file], draft: state, write }),
	).toEqual(["/fixture/.jedv/attachments/fixture.txt"]);
	expect(
		await copyPromptAttachments({ files: [{ ...file }], draft: state, write }),
	).toEqual(["/fixture/.jedv/attachments/fixture.txt"]);
	expect(copies).toBe(1);
});
test("an incomplete or unknown copy response is never presented as success", async () => {
	const state = draft();
	await expect(
		copyPromptAttachments({
			files: [file],
			draft: state,
			write: async () => ({ ok: true, paths: [] }),
		}),
	).rejects.toThrow("incomplete");
	expect(state.copyUnknown).toBe(true);
	expect(state.paths.size).toBe(0);
	const other = draft();
	await expect(
		copyPromptAttachments({
			files: [file],
			draft: other,
			write: async () => {
				throw new Error("connection lost");
			},
		}),
	).rejects.toThrow("connection lost");
	expect(other.copyUnknown).toBe(true);
});
test("unreadable blob URLs do not call the attachment writer", async () => {
	let copied = false;
	await expect(
		copyPromptAttachments({
			files: [{ ...file, url: "blob:unreadable" }],
			draft: draft(),
			write: async () => {
				copied = true;
				return { ok: true, paths: [] };
			},
		}),
	).rejects.toThrow("unreadable");
	expect(copied).toBe(false);
});
