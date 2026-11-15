import type { CodexTransport, CodexTransportHandlers } from "./rpcClient";

export interface CodexUnixSocket {
	on(event: "open", listener: () => void): void;
	on(event: "message", listener: (data: { toString(): string }) => void): void;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: () => void): void;
	send(data: string): void;
	terminate(): void;
}

export function connectUnixCodexTransport(
	options: {
		socketPath: string;
		createSocket: (url: string) => CodexUnixSocket;
		connectTimeoutMs?: number;
	},
	handlers: CodexTransportHandlers,
): CodexTransport {
	if (!options.socketPath.startsWith("/") || /[:?#]/.test(options.socketPath)) {
		throw new Error("Codex requires a local absolute Unix socket path");
	}
	const socket = options.createSocket(`ws+unix://${options.socketPath}:/`);
	let opened = false;
	let closed = false;
	const queued: string[] = [];
	const finish = () => {
		if (closed) return;
		closed = true;
		clearTimeout(timer);
		queued.length = 0;
		handlers.onExit(null, null);
	};
	const timer = setTimeout(() => {
		handlers.onStderr("Codex Unix connection timed out");
		finish();
		socket.terminate();
	}, options.connectTimeoutMs ?? 5_000);
	socket.on("open", () => {
		if (closed) return;
		clearTimeout(timer);
		opened = true;
		for (const line of queued.splice(0)) socket.send(line);
	});
	socket.on("message", (data) => {
		if (!closed) handlers.onLine(data.toString());
	});
	socket.on("error", (error) => {
		handlers.onStderr(error.message);
		finish();
		socket.terminate();
	});
	socket.on("close", finish);
	return {
		send(line) {
			if (closed) throw new Error("Codex Unix connection is closed");
			if (opened) socket.send(line);
			else if (queued.length < 128) queued.push(line);
			else throw new Error("Codex connection queue is full");
		},
		async close() {
			finish();
			socket.terminate();
		},
	};
}
