import { Label } from "@jedv/ui/label";
import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiCheckCircle } from "react-icons/hi2";
import type { LocalClient } from "../../../../local-client";

interface NamingInstructionsSectionProps {
	projectId: string;
	hostUrl: string;
	client: LocalClient;
	instructions: string | null;
	onChanged: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 500;
const SAVED_INDICATOR_MS = 2000;

export function NamingInstructionsSection({
	projectId,
	client,
	instructions,
	onChanged,
}: NamingInstructionsSectionProps) {
	const { t } = useLingui();
	const savedValue = instructions ?? "";
	const [value, setValue] = useState(savedValue);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const latestValueRef = useRef(value);
	const lastSavedRef = useRef(savedValue);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveInFlightRef = useRef(false);
	const queuedValueRef = useRef<string | null>(null);
	const isMountedRef = useRef(true);

	useEffect(() => {
		const isFocused =
			!!textareaRef.current && document.activeElement === textareaRef.current;
		if (isFocused || debounceTimerRef.current || saveInFlightRef.current) {
			return;
		}
		setValue(savedValue);
		latestValueRef.current = savedValue;
		lastSavedRef.current = savedValue;
	}, [savedValue]);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		};
	}, []);

	const saveMutation = useMutation({
		mutationFn: (next: string) =>
			client.project.setNamingInstructions.mutate({
				projectId,

				instructions: next.trim() || null,
			}),
	});

	const flushSaveRef = useRef<((next: string) => Promise<void>) | null>(null);
	const flushSave = useCallback(
		async (next: string) => {
			if (saveInFlightRef.current) {
				queuedValueRef.current = next;
				return;
			}
			if (next.trim() === lastSavedRef.current.trim()) {
				queuedValueRef.current = null;
				return;
			}

			if (savedTimerRef.current) {
				clearTimeout(savedTimerRef.current);
				savedTimerRef.current = null;
			}
			setSaveStatus("saving");
			saveInFlightRef.current = true;
			try {
				await saveMutation.mutateAsync(next);
				lastSavedRef.current = next;
				if (!isMountedRef.current) return;
				setSaveStatus("saved");
				savedTimerRef.current = setTimeout(() => {
					setSaveStatus("idle");
					savedTimerRef.current = null;
				}, SAVED_INDICATOR_MS);
				onChanged();
			} catch (err) {
				console.warn("[naming-instructions/save] failed", err);
				if (isMountedRef.current) setSaveStatus("error");
			} finally {
				saveInFlightRef.current = false;
				const pending = queuedValueRef.current;
				queuedValueRef.current = null;
				if (pending !== null && isMountedRef.current) {
					void flushSaveRef.current?.(pending);
				}
			}
		},
		[onChanged, saveMutation],
	);
	flushSaveRef.current = flushSave;

	const handleChange = useCallback(
		(nextValue: string) => {
			setValue(nextValue);
			latestValueRef.current = nextValue;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = setTimeout(() => {
				debounceTimerRef.current = null;
				void flushSave(latestValueRef.current);
			}, SAVE_DEBOUNCE_MS);
		},
		[flushSave],
	);

	const handleBlur = useCallback(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		void flushSave(latestValueRef.current);
	}, [flushSave]);

	return (
		<div className="pt-4">
			<div className="mb-3">
				<Label
					htmlFor="project-naming-instructions"
					className="text-sm font-medium"
				>
					<Trans>Naming instructions</Trans>
				</Label>
				<p className="mt-0.5 text-xs text-muted-foreground">
					<Trans>
						Guides AI-generated workspace and branch names for this project.
						Empty uses the default naming.
					</Trans>
				</p>
			</div>
			<Textarea
				ref={textareaRef}
				id="project-naming-instructions"
				value={value}
				onChange={(e) => handleChange(e.target.value)}
				onBlur={handleBlur}
				placeholder={t({
					message:
						"Include the Linear ticket id from the prompt in the branch name (e.g. bin-344-fix-login). Prefix branches with fix/ or feat/ based on the task.",
				})}
				rows={3}
				spellCheck={false}
				className="text-sm resize-y min-h-[calc(3lh+1.125rem)]"
			/>
			<div className="flex h-4 items-center justify-end text-xs text-muted-foreground">
				{saveStatus === "saving" && (
					<span>
						<Trans>Saving…</Trans>
					</span>
				)}
				{saveStatus === "saved" && (
					<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
						<HiCheckCircle className="h-3.5 w-3.5" />
						<Trans>Saved</Trans>
					</span>
				)}
				{saveStatus === "error" && (
					<span className="select-text cursor-text text-destructive">
						<Trans>Couldn't save. Edit or click away to retry</Trans>
					</span>
				)}
			</div>
		</div>
	);
}
