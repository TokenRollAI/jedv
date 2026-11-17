import { describe, expect, it } from "bun:test";
import {
	filterListeningPorts,
	getListeningPortsForPids,
	getProcessTreesForPids,
	isInternalAgentLoopbackPort,
	parseLsofOutput,
} from "./scanner.ts";

describe("getProcessTreesForPids (real process table)", () => {
	it("returns an empty map for no roots", async () => {
		expect((await getProcessTreesForPids([])).size).toBe(0);
	});

	it("includes the root pid and its descendants from one table read", async () => {
		// Not `sleep` — this package supports win32, where that binary is absent.
		const child = Bun.spawn([
			process.execPath,
			"-e",
			"setTimeout(() => {}, 5000)",
		]);
		try {
			const trees = await getProcessTreesForPids([process.pid]);
			const tree = trees.get(process.pid);
			expect(tree).toContain(process.pid);
			expect(tree).toContain(child.pid);
		} finally {
			child.kill();
		}
	});

	it("omits roots that are not running", async () => {
		// PID_MAX on macOS is 99998 and on Linux defaults to 4194304, so this
		// pid can never exist.
		const trees = await getProcessTreesForPids([process.pid, 99_999_999]);
		expect(trees.has(99_999_999)).toBe(false);
		expect(trees.has(process.pid)).toBe(true);
	});
});

describe("getListeningPortsForPids (real sockets)", () => {
	it("finds a genuinely listening port for our own pid", async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		try {
			const listeningPort = server.port;
			if (listeningPort === undefined) throw new Error("server has no port");
			const ports = await getListeningPortsForPids([process.pid]);
			expect(ports.map((info) => info.port)).toContain(listeningPort);
			expect(ports.every((info) => info.pid === process.pid)).toBe(true);
		} finally {
			server.stop(true);
		}
	});

	it("returns nothing for a pid that is not running", async () => {
		const ports = await getListeningPortsForPids([99_999_999]);
		expect(ports).toHaveLength(0);
	});

	it("filters out ephemeral loopback listeners opened on 127.0.0.1", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("ok"),
		});
		try {
			const listeningPort = server.port;
			if (listeningPort === undefined) throw new Error("server has no port");
			expect(listeningPort).toBeGreaterThanOrEqual(49152);
			const ports = await getListeningPortsForPids([process.pid]);
			expect(ports.map((info) => info.port)).not.toContain(listeningPort);
		} finally {
			server.stop(true);
		}
	});
});

describe("filterListeningPorts (internal agent CLI loopback filter)", () => {
	it("filters loopback ephemeral ports and agent CLI loopback ports while preserving user dev servers", () => {
		const input = [
			{ port: 54321, pid: 1, address: "127.0.0.1", processName: "agy" },
			{ port: 35000, pid: 1, address: "127.0.0.1", processName: "agy" },
			{ port: 41000, pid: 2, address: "::1", processName: "claude" },
			{ port: 42000, pid: 3, address: "127.0.0.1", processName: "codex" },
			{ port: 43000, pid: 4, address: "127.0.0.1", processName: "kimi" },
			{ port: 55000, pid: 5, address: "127.0.0.1", processName: "node" },
			{ port: 3000, pid: 6, address: "127.0.0.1", processName: "node" },
			{ port: 5173, pid: 7, address: "::1", processName: "vite" },
			{ port: 55000, pid: 8, address: "0.0.0.0", processName: "bun" },
		];

		expect(filterListeningPorts(input)).toEqual([
			{ port: 3000, pid: 6, address: "127.0.0.1", processName: "node" },
			{ port: 5173, pid: 7, address: "::1", processName: "vite" },
			{ port: 55000, pid: 8, address: "0.0.0.0", processName: "bun" },
		]);
		expect(
			isInternalAgentLoopbackPort({
				port: 54321,
				pid: 1,
				address: "0:0:0:0:0:0:0:1",
				processName: "node",
			}),
		).toBe(true);
	});
});

describe("port-scanner", () => {
	describe("parseLsofOutput", () => {
		it("should parse standard lsof output with (LISTEN) suffix", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(1);
			expect(ports[0]).toEqual({
				port: 3000,
				pid: 12345,
				address: "0.0.0.0",
				processName: "node",
			});
		});

		it("should parse localhost address", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP 127.0.0.1:8080 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(1);
			expect(ports[0]).toEqual({
				port: 8080,
				pid: 12345,
				address: "127.0.0.1",
				processName: "node",
			});
		});

		it("should parse IPv6 addresses", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv6 0x1234567890ab      0t0  TCP [::1]:3000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(1);
			expect(ports[0]).toEqual({
				port: 3000,
				pid: 12345,
				address: "::1",
				processName: "node",
			});
		});

		it("should parse IPv6 wildcard addresses", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv6 0x1234567890ab      0t0  TCP [::]:8000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(1);
			expect(ports[0]).toEqual({
				port: 8000,
				pid: 12345,
				address: "::",
				processName: "node",
			});
		});

		it("should parse multiple ports", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)
node      12345   user   24u  IPv4 0x1234567890ac      0t0  TCP *:3001 (LISTEN)
python    67890   user   5u   IPv4 0x1234567890ad      0t0  TCP 127.0.0.1:8000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(3);
			expect(ports[0]).toEqual({
				port: 3000,
				pid: 12345,
				address: "0.0.0.0",
				processName: "node",
			});
			expect(ports[1]).toEqual({
				port: 3001,
				pid: 12345,
				address: "0.0.0.0",
				processName: "node",
			});
			expect(ports[2]).toEqual({
				port: 8000,
				pid: 67890,
				address: "127.0.0.1",
				processName: "python",
			});
		});

		it("should handle empty output", () => {
			const ports = parseLsofOutput("");
			expect(ports).toHaveLength(0);
		});

		it("should handle header-only output", () => {
			const output =
				"COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME";
			const ports = parseLsofOutput(output);
			expect(ports).toHaveLength(0);
		});

		it("should skip lines with insufficient columns", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)
short line
node      67890   user   24u  IPv4 0x1234567890ac      0t0  TCP *:4000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(2);
			expect(ports[0]?.port).toBe(3000);
			expect(ports[1]?.port).toBe(4000);
		});

		it("should skip invalid port numbers", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:0 (LISTEN)
node      12345   user   24u  IPv4 0x1234567890ac      0t0  TCP *:70000 (LISTEN)
node      12345   user   25u  IPv4 0x1234567890ad      0t0  TCP *:3000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(1);
			expect(ports[0]?.port).toBe(3000);
		});

		it("should handle real-world lsof output format", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF                NODE NAME
rapportd    947 kietho    8u  IPv4 0x9e27f4f0c86f6338      0t0                 TCP *:59251 (LISTEN)
ControlCe  1020 kietho    8u  IPv4 0xe6bd39002aa591ca      0t0                 TCP *:7000 (LISTEN)
postgres   3457 kietho    8u  IPv4 0xb4db4c0cd4dfeb63      0t0                 TCP 127.0.0.1:5432 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(3);
			expect(ports[0]).toEqual({
				port: 59251,
				pid: 947,
				address: "0.0.0.0",
				processName: "rapportd",
			});
			expect(ports[1]).toEqual({
				port: 7000,
				pid: 1020,
				address: "0.0.0.0",
				processName: "ControlCe",
			});
			expect(ports[2]).toEqual({
				port: 5432,
				pid: 3457,
				address: "127.0.0.1",
				processName: "postgres",
			});
		});

		it("should not parse (LISTEN) as the port name", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(1);
			expect(ports[0]?.port).toBe(3000);
			expect(ports[0]?.address).toBe("0.0.0.0");
		});

		it("should handle process names with different lengths", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
n         12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)
verylongprocessname 67890   user   24u  IPv4 0x1234567890ac      0t0  TCP *:4000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(2);
			expect(ports[0]?.processName).toBe("n");
			expect(ports[0]?.port).toBe(3000);
			expect(ports[1]?.processName).toBe("verylongprocessname");
			expect(ports[1]?.port).toBe(4000);
		});
	});

	describe("parseLsofOutput with PID filtering", () => {
		it("should filter ports by allowed PIDs", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)
python    67890   user   5u   IPv4 0x1234567890ad      0t0  TCP *:8000 (LISTEN)
ruby      99999   user   6u   IPv4 0x1234567890ae      0t0  TCP *:9000 (LISTEN)`;

			const allowedPids = new Set([12345, 99999]);
			const ports = parseLsofOutput(output, allowedPids);

			expect(ports).toHaveLength(2);
			expect(ports[0]?.pid).toBe(12345);
			expect(ports[0]?.port).toBe(3000);
			expect(ports[1]?.pid).toBe(99999);
			expect(ports[1]?.port).toBe(9000);
		});

		it("should return empty when no PIDs match", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)
python    67890   user   5u   IPv4 0x1234567890ad      0t0  TCP *:8000 (LISTEN)`;

			const allowedPids = new Set([11111, 22222]);
			const ports = parseLsofOutput(output, allowedPids);

			expect(ports).toHaveLength(0);
		});

		it("should return all ports when allowedPids is not provided", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   23u  IPv4 0x1234567890ab      0t0  TCP *:3000 (LISTEN)
python    67890   user   5u   IPv4 0x1234567890ad      0t0  TCP *:8000 (LISTEN)`;

			const ports = parseLsofOutput(output);

			expect(ports).toHaveLength(2);
		});

		it("should handle lsof returning unrelated ports when -p filter fails", () => {
			const output = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF                NODE NAME
rapportd    947 kietho    8u  IPv4 0x9e27f4f0c86f6338      0t0                 TCP *:59251 (LISTEN)
ControlCe  1020 kietho    8u  IPv4 0xe6bd39002aa591ca      0t0                 TCP *:7000 (LISTEN)
postgres   3457 kietho    8u  IPv4 0xb4db4c0cd4dfeb63      0t0                 TCP 127.0.0.1:5432 (LISTEN)
node      12345 kietho   23u  IPv4 0x1234567890ab          0t0                 TCP *:3000 (LISTEN)`;

			const allowedPids = new Set([12345]);
			const ports = parseLsofOutput(output, allowedPids);

			expect(ports).toHaveLength(1);
			expect(ports[0]?.port).toBe(3000);
			expect(ports[0]?.pid).toBe(12345);
		});
	});
});
