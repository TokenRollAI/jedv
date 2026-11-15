import { expect, mock, test } from "bun:test";
import { once } from "node:events";
import express from "express";
import { listenForNotifications } from "./listen";

test("notification listener reports its real bound port and never claims a busy port", async () => {
	const firstLog = { log: mock(() => {}), error: mock(() => {}) };
	const first = listenForNotifications(express(), 0, firstLog);
	await once(first, "listening");
	const address = first.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture port");
	const failedLog = { log: mock(() => {}), error: mock(() => {}) };
	const second = listenForNotifications(express(), address.port, failedLog);
	try {
		await once(second, "error");
		expect(firstLog.log).toHaveBeenCalledWith(
			`[notifications] Listening on http://127.0.0.1:${address.port}`,
		);
		expect(failedLog.log).not.toHaveBeenCalled();
		expect(failedLog.error).toHaveBeenCalledTimes(1);
		expect(second.listening).toBe(false);
	} finally {
		first.close();
		second.close();
	}
});
