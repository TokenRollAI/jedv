import { expect, test } from "bun:test";
import { networkFixture } from "./test-fixture";

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const input = {
	id: "host-b",
	name: "old",
	origin: "https://b.test.ts.net",
	outboundToken: "o".repeat(43),
};

test("remove waits for the complete in-flight upsert and leaves no Peer or accepted credential", async () => {
	const f = networkFixture(),
		entered = barrier(),
		release = barrier();
	try {
		const original = await f.peers.upsert(input),
			set = f.peers.secrets.set.bind(f.peers.secrets);
		f.peers.secrets.set = async (id, value) => {
			const work = set(id, value);
			if (value === "n".repeat(43)) {
				entered.resolve();
				await release.promise;
			}
			return work;
		};
		const updating = f.peers.upsert({
			...input,
			name: "new",
			outboundToken: "n".repeat(43),
		});
		await entered.promise;
		const removing = f.peers.remove(input.id);
		release.resolve();
		expect(
			(await Promise.allSettled([updating, removing])).map(
				(result) => result.status,
			),
		).toEqual(["fulfilled", "fulfilled"]);
		expect(f.peers.list().items).toHaveLength(0);
		expect(f.peers.secrets.get(input.id)).toBeNull();
		expect(
			f.sqlite.prepare("SELECT id FROM peer_hosts WHERE id=?").get(input.id),
		).toBeNull();
		expect(() =>
			f.peers.authenticatePeer(input.id, original.inboundToken ?? ""),
		).toThrow();
	} finally {
		release.resolve();
		await f.dispose();
	}
});
test("failed concurrent update rolls back only its own secret snapshot and the queue accepts later changes", async () => {
	const f = networkFixture();
	try {
		await f.peers.upsert(input);
		f.sqlite.exec(
			"CREATE TRIGGER reject_race_update BEFORE UPDATE ON peer_hosts WHEN NEW.name='fail' BEGIN SELECT RAISE(ABORT,'isolated fault'); END;",
		);
		const result = await Promise.allSettled([
			f.peers.upsert({
				...input,
				name: "success",
				outboundToken: "a".repeat(43),
			}),
			f.peers.upsert({ ...input, name: "fail", outboundToken: "b".repeat(43) }),
		]);
		expect(result.map((item) => item.status)).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(f.peers.peer(input.id).name).toBe("success");
		expect(f.peers.peer(input.id).outboundTokenHint).toBe("••••aaaa");
		expect(f.peers.secrets.get(input.id)).toBe("a".repeat(43));
		await f.peers.upsert({
			...input,
			name: "after failure",
			outboundToken: "c".repeat(43),
		});
		expect(f.peers.secrets.get(input.id)).toBe("c".repeat(43));
		expect(f.peers.peer(input.id).outboundTokenHint).toBe("••••cccc");
	} finally {
		await f.dispose();
	}
});
test("inbound rotation shares the same Peer sequence and cannot be undone by a paused outbound save", async () => {
	const f = networkFixture(),
		entered = barrier(),
		release = barrier();
	try {
		const original = await f.peers.upsert(input),
			set = f.peers.secrets.set.bind(f.peers.secrets);
		f.peers.secrets.set = async (id, value) => {
			const work = set(id, value);
			if (value === "n".repeat(43)) {
				entered.resolve();
				await release.promise;
			}
			return work;
		};
		const updating = f.peers.upsert({
			...input,
			name: "saving",
			outboundToken: "n".repeat(43),
		});
		await entered.promise;
		const rotating = f.peers.rotateInbound(input.id);
		release.resolve();
		const [, rotated] = await Promise.all([updating, rotating]);
		expect(() =>
			f.peers.authenticatePeer(input.id, original.inboundToken ?? ""),
		).toThrow();
		expect(f.peers.authenticatePeer(input.id, rotated.inboundToken)).toBe(
			input.id,
		);
		expect(f.peers.secrets.get(input.id)).toBe("n".repeat(43));
		await f.peers.upsert({
			...input,
			name: "later",
			outboundToken: "a".repeat(43),
		});
		expect(f.peers.authenticatePeer(input.id, rotated.inboundToken)).toBe(
			input.id,
		);
	} finally {
		release.resolve();
		await f.dispose();
	}
});
