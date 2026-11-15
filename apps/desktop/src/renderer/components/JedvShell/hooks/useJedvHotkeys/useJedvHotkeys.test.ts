import { expect, test } from "bun:test";
import { PLATFORM } from "renderer/hotkeys/registry";
import { handleJedvHotkey, resolveJedvHotkey } from "./useJedvHotkeys";

test("Escape reaches CLI/editor input and only returns from an unblocked Settings surface", () => {
	for (const [canGoBack, editing, overlayOpen, handled] of [
		[false, false, false, false],
		[false, true, false, false],
		[true, true, false, false],
		[true, false, true, false],
		[true, false, false, true],
	] as const) {
		let prevented = false;
		let stopped = false;
		const actions: string[] = [];
		const event = {
			key: "Escape",
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			isComposing: false,
			defaultPrevented: false,
			target: { closest: () => (editing ? {} : null) },
			preventDefault: () => {
				prevented = true;
			},
			stopPropagation: () => {
				stopped = true;
			},
		} as unknown as KeyboardEvent;
		handleJedvHotkey(event, (action) => actions.push(action), {
			canGoBack,
			isMac: true,
			overlayOpen,
		});
		expect(prevented).toBe(handled);
		expect(stopped).toBe(handled);
		expect(actions).toEqual(handled ? ["back"] : []);
	}
});

test("workspace and tab number shortcuts keep separate registry actions", () => {
	const event = (altKey: boolean) =>
		({
			type: "keydown",
			key: "1",
			code: "Digit1",
			metaKey: PLATFORM === "mac",
			ctrlKey: PLATFORM !== "mac",
			shiftKey: PLATFORM !== "mac",
			altKey,
			isComposing: false,
		}) as KeyboardEvent;
	expect(resolveJedvHotkey(event(false), PLATFORM === "mac")).toBe(
		"workspace-1",
	);
	expect(resolveJedvHotkey(event(true), PLATFORM === "mac")).toBe("tab-1");
});

test("declared Control-number scripts work without taking CLI Control-letter chords", () => {
	const event = {
		type: "keydown",
		key: "1",
		code: "Digit1",
		ctrlKey: true,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
	} as KeyboardEvent;
	expect(resolveJedvHotkey(event, true)).toBe("preset-1");
	expect(
		resolveJedvHotkey(
			{ ...event, key: "t", code: "KeyT" } as KeyboardEvent,
			true,
		),
	).toBeNull();
});
