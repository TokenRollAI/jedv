import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { connectUnixCodexTransport } from "./unixTransport";

test("Unix Codex transport queues initial RPC and disconnects only its own socket", async () => {
	const socket = Object.assign(new EventEmitter(), {
		sent: [] as string[],
		terminated: 0,
		send(data: string) {
			this.sent.push(data);
		},
		terminate() {
			this.terminated++;
			socket.emit("close");
		},
	});
	const received: string[] = [];
	let exits = 0;
	const transport = connectUnixCodexTransport(
		{
			socketPath: "/tmp/jedv-codex-test.sock",
			createSocket: (url) => {
				expect(url).toBe("ws+unix:///tmp/jedv-codex-test.sock:/");
				return socket;
			},
		},
		{
			onLine: (line) => received.push(line),
			onStderr: () => {},
			onExit: () => {
				exits++;
			},
		},
	);
	transport.send('{"id":1,"method":"initialize"}');
	expect(socket.sent).toHaveLength(0);
	socket.emit("open");
	expect(socket.sent).toEqual(['{"id":1,"method":"initialize"}']);
	socket.emit("message", Buffer.from('{"id":1,"result":{}}'));
	expect(received).toEqual(['{"id":1,"result":{}}']);
	await transport.close();
	expect(exits).toBe(1);
	expect(socket.terminated).toBe(1);
	expect(() => transport.send("late")).toThrow("closed");
});
