import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@jedv/ui/alert-dialog";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Switch } from "@jedv/ui/switch";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { HotkeyLabel } from "renderer/hotkeys/components/HotkeyLabel";
import { useRecordHotkeys } from "renderer/hotkeys/hooks/useRecordHotkeys";
import { HOTKEYS, type HotkeyId, PLATFORM } from "renderer/hotkeys/registry";
import { useHotkeyOverridesStore } from "renderer/hotkeys/stores/hotkeyOverridesStore";
import {
	getEffectiveLayoutMap,
	useKeyboardPreferencesStore,
} from "renderer/hotkeys/stores/keyboardPreferencesStore";
import type { ShortcutBinding } from "renderer/hotkeys/types";
import { bindingToDispatchChord } from "renderer/hotkeys/utils/binding";
import { canonicalizeChord } from "renderer/hotkeys/utils/resolveHotkeyFromEvent";
import { JEDV_HOTKEY_ACTIONS } from "../../../../hooks/useJedvHotkeys/useJedvHotkeys";
import { SettingRow } from "../SettingRow";
import { isCliControlBinding } from "./keyboard-binding";

export const SETTINGS_HOTKEY_IDS = Object.keys(
	JEDV_HOTKEY_ACTIONS,
) as HotkeyId[];
const categoryLabels = {
	Navigation: msg({ message: "Navigation" }),
	Workspace: msg({ message: "Workspace" }),
	Layout: msg({ message: "Layout" }),
	Terminal: msg({ message: "Terminal" }),
	Chat: msg({ message: "Chat" }),
	Window: msg({ message: "Window" }),
	Help: msg({ message: "Help" }),
};

export function KeyboardSettings() {
	const { t, i18n } = useLingui();
	const [query, setQuery] = useState("");
	const [recording, setRecording] = useState<HotkeyId | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [conflict, setConflict] = useState<{
		id: HotkeyId;
		binding: ShortcutBinding;
		reset?: boolean;
	} | null>(null);
	const [resettingAll, setResettingAll] = useState(false);
	const { overrides, setOverride, resetOverride, resetAll } =
		useHotkeyOverridesStore();
	const adaptive = useKeyboardPreferencesStore(
		(state) => state.adaptiveLayoutEnabled,
	);
	const setAdaptive = useKeyboardPreferencesStore(
		(state) => state.setAdaptiveLayoutEnabled,
	);
	const label = (id: HotkeyId) =>
		id === "TOGGLE_SIDEBAR"
			? t({ message: "Toggle agent controls" })
			: i18n._(HOTKEYS[id].label);
	const conflictsFor = (id: HotkeyId, binding: ShortcutBinding) => {
		const layout = getEffectiveLayoutMap();
		const dispatch = bindingToDispatchChord(binding, layout);
		if (!dispatch) return [];
		return (Object.keys(HOTKEYS) as HotkeyId[]).filter((other) => {
			const effective =
				other in overrides ? overrides[other] : HOTKEYS[other].key;
			const chord = effective
				? bindingToDispatchChord(effective, layout)
				: null;
			return (
				other !== id &&
				chord &&
				canonicalizeChord(chord) === canonicalizeChord(dispatch)
			);
		});
	};
	useRecordHotkeys(recording, {
		preferredMode: adaptive ? "logical" : "physical",
		onSave: (id, binding) => {
			setRecording(null);
			if (isCliControlBinding(binding, PLATFORM === "mac")) {
				if (id in overrides) setOverride(id, overrides[id] ?? null);
				else resetOverride(id);
				setNotice(
					t({
						message:
							"Control shortcuts on macOS are reserved for terminal programs.",
					}),
				);
			} else setNotice(null);
		},
		onCancel: () => setRecording(null),
		onUnassign: () => setRecording(null),
		onConflict: (id, binding) => {
			if (isCliControlBinding(binding, PLATFORM === "mac")) {
				setNotice(
					t({
						message:
							"Control shortcuts on macOS are reserved for terminal programs.",
					}),
				);
				return;
			}
			setRecording(null);
			setConflict({ id, binding });
		},
		onReserved: (_binding, info) => setNotice(info.reason),
	});
	const visible = SETTINGS_HOTKEY_IDS.filter((id) =>
		`${label(id)} ${i18n._(HOTKEYS[id].description ?? HOTKEYS[id].label)} ${i18n._(categoryLabels[HOTKEYS[id].category])}`
			.toLocaleLowerCase()
			.includes(query.toLocaleLowerCase()),
	);
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-2">
				<Input
					className="h-8 min-w-40 flex-1"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					aria-label={t({ message: "Search shortcuts" })}
					placeholder={t({ message: "Search shortcuts…" })}
				/>
				<Button
					size="sm"
					variant="outline"
					disabled={!Object.keys(overrides).length}
					onClick={() => {
						setRecording(null);
						setResettingAll(true);
					}}
				>
					<Trans>Reset all</Trans>
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				<Trans>
					Select a shortcut and press the new keys. Escape cancels; Backspace
					clears the binding.
				</Trans>
			</p>
			{notice && (
				<p role="alert" className="text-xs text-destructive">
					{notice}
				</p>
			)}
			<div className="rounded-lg border border-border">
				<SettingRow
					label={t({ message: "Adaptive keyboard layout" })}
					description={t({
						message:
							"Follow the characters printed on your keyboard instead of physical key positions.",
					})}
				>
					<Switch
						aria-label={t({ message: "Adaptive keyboard layout" })}
						checked={adaptive}
						onCheckedChange={setAdaptive}
					/>
				</SettingRow>
			</div>
			{Object.entries(categoryLabels).map(([category, descriptor]) => {
				const ids = visible.filter((id) => HOTKEYS[id].category === category);
				return (
					ids.length > 0 && (
						<section key={category} className="space-y-2">
							<h3 className="text-sm font-medium">{i18n._(descriptor)}</h3>
							<div className="divide-y overflow-hidden rounded-lg border border-border">
								{ids.map((id) => (
									<SettingRow key={id} label={label(id)}>
										<div className="flex flex-wrap items-center gap-2">
											<Button
												size="sm"
												variant={recording === id ? "secondary" : "outline"}
												onClick={() => {
													setNotice(null);
													setRecording(recording === id ? null : id);
												}}
											>
												{recording === id ? (
													<Trans>Press shortcut…</Trans>
												) : (
													<HotkeyLabel
														id={id}
														fallbackLabel={t({ message: "Unassigned" })}
													/>
												)}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												disabled={recording === id}
												onClick={() => setOverride(id, null)}
												aria-label={t({ message: "Clear shortcut" })}
											>
												<Trans>Clear</Trans>
											</Button>
											<Button
												variant="ghost"
												size="sm"
												disabled={!(id in overrides)}
												onClick={() => {
													setRecording(null);
													const binding = HOTKEYS[id].key;
													if (binding && conflictsFor(id, binding).length)
														setConflict({ id, binding, reset: true });
													else resetOverride(id);
												}}
											>
												<Trans>Reset</Trans>
											</Button>
										</div>
									</SettingRow>
								))}
							</div>
						</section>
					)
				);
			})}
			{visible.length === 0 && (
				<output className="text-xs text-muted-foreground">
					<Trans>No matching shortcuts.</Trans>
				</output>
			)}
			<AlertDialog
				open={!!conflict}
				onOpenChange={(open) => {
					if (!open) setConflict(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Reassign this shortcut?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							{conflict && (
								<Trans>
									This shortcut will be assigned to {label(conflict.id)}. These
									actions will become unassigned:{" "}
									{conflictsFor(conflict.id, conflict.binding)
										.map(label)
										.join(", ")}
									.
								</Trans>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (!conflict) return;
								for (const id of conflictsFor(conflict.id, conflict.binding))
									setOverride(id, null);
								if (conflict.reset) resetOverride(conflict.id);
								else setOverride(conflict.id, conflict.binding);
								setConflict(null);
								setNotice(null);
							}}
						>
							<Trans>Reassign shortcut</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog open={resettingAll} onOpenChange={setResettingAll}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Reset all shortcuts?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This removes all custom shortcut bindings, including actions
								outside this list.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction onClick={resetAll}>
							<Trans>Reset all</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
