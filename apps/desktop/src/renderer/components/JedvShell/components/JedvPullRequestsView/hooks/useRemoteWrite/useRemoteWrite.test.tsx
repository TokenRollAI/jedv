import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRemoteWrite } from "./useRemoteWrite";

afterEach(cleanup);
test("an unknown remote write cannot repeat until a successful explicit refresh", async () => {
	const write = mock(async () => {
		throw new Error("fixture connection lost after write");
	});
	const hook = renderHook(() => useRemoteWrite());
	await act(async () => {
		await expect(hook.result.current.run(write)).rejects.toThrow(
			"connection lost",
		);
	});
	expect(hook.result.current.blocked).toBe(true);
	await act(async () => {
		await expect(hook.result.current.run(write)).rejects.toThrow(
			"Refresh before retrying",
		);
	});
	expect(write).toHaveBeenCalledTimes(1);
	await act(async () => {
		await expect(
			hook.result.current.refresh(async () => {
				throw new Error("offline");
			}),
		).rejects.toThrow("offline");
	});
	expect(hook.result.current.blocked).toBe(true);
	await act(async () => {
		await hook.result.current.refresh(async () => ({ verified: true }));
	});
	expect(hook.result.current.blocked).toBe(false);
	const success = mock(async () => "ok");
	await act(async () => {
		expect(await hook.result.current.run(success)).toBe("ok");
	});
	expect(success).toHaveBeenCalledTimes(1);
});
