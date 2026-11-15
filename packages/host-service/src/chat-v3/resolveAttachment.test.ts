import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AttachmentMetadata,
	indexAttachmentFileId,
	writeAttachment,
} from "../trpc/router/attachments/storage";
import { createAttachmentResolver } from "./resolveAttachment";

let manifestDir: string;

beforeEach(() => {
	manifestDir = mkdtempSync(join(tmpdir(), "jedv-resolve-attachment-"));
	process.env.HOST_MANIFEST_DIR = manifestDir;
});

afterEach(() => {
	rmSync(manifestDir, { recursive: true, force: true });
	delete process.env.HOST_MANIFEST_DIR;
});

function store(fields: Partial<AttachmentMetadata> = {}): AttachmentMetadata {
	const metadata: AttachmentMetadata = {
		attachmentId: crypto.randomUUID(),
		mediaType: "image/png",
		sizeBytes: 3,
		createdAt: 0,
		...fields,
	};
	writeAttachment(new Uint8Array([1, 2, 3]), metadata);
	if (metadata.fileId)
		indexAttachmentFileId({ ...metadata, fileId: metadata.fileId });
	return metadata;
}

function resolverWith() {
	const reported: unknown[] = [];
	const resolve = createAttachmentResolver({
		report: (error) => reported.push(error),
	});
	return { resolve, reported };
}

const part = (ids: { attachmentId?: string; fileId?: string }) => ({
	type: "attachment" as const,
	...ids,
	name: "shot.png",
	mimeType: "image/png",
});

describe("createAttachmentResolver", () => {
	it("reads a host part from the store by its attachmentId", async () => {
		const entry = store();
		const { resolve } = resolverWith();
		expect(await resolve(part({ attachmentId: entry.attachmentId }))).toEqual({
			path: expect.stringContaining(entry.attachmentId),
			mimeType: "image/png",
			data: Buffer.from([1, 2, 3]).toString("base64"),
		});
	});

	it("reads an existing fileId from the local cache", async () => {
		const fileId = crypto.randomUUID();
		const entry = store({ fileId });
		const { resolve } = resolverWith();

		const file = await resolve(part({ fileId }));
		expect(file?.path).toContain(entry.attachmentId);
	});

	it("prefers the fileId when a part carries both", async () => {
		const fileId = crypto.randomUUID();
		const cloudCopy = store({ fileId });
		const hostEntry = store();
		const { resolve } = resolverWith();

		const file = await resolve(
			part({ attachmentId: hostEntry.attachmentId, fileId }),
		);
		expect(file?.path).toContain(cloudCopy.attachmentId);
	});

	it("gives null for an id the store does not have", async () => {
		const { resolve, reported } = resolverWith();
		expect(
			await resolve(part({ attachmentId: crypto.randomUUID() })),
		).toBeNull();
		expect(reported).toEqual([]);
	});

	it("returns null for a fileId missing locally without fetching it", async () => {
		const { resolve, reported } = resolverWith();
		expect(await resolve(part({ fileId: crypto.randomUUID() }))).toBeNull();
		expect(reported).toEqual([]);
	});

	it("hands a non-image over by path, without reading its bytes", async () => {
		const entry = store({ mediaType: "application/pdf" });
		const { resolve } = resolverWith();
		expect(
			(await resolve(part({ attachmentId: entry.attachmentId })))?.data,
		).toBe("");
	});
});
