import { Textarea } from "@jedv/ui/textarea";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiCheckCircle } from "react-icons/hi2";
import type { LocalClient } from "../../../../local-client";

interface SparseCheckoutSectionProps {
	projectId: string;
	hostUrl: string;
	client: LocalClient;
	paths: string[];
	onChanged: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";

const SAVE_DEBOUNCE_MS = 500;
const SAVED_INDICATOR_MS = 2000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

function toLines(paths: string[]): string {
	return paths.join("\n");
}

function toPaths(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function pathsEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((path, i) => path === b[i]);
}

export function SparseCheckoutSection({
	projectId,
	client,
	paths,
	onChanged,
}: SparseCheckoutSectionProps) {
	const [value, setValue] = useState(() => toLines(paths));
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const [invalidMessage, setInvalidMessage] = useState<string | null>(null);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isFocused = useCallback(
		() =>
			!!textareaRef.current && document.activeElement === textareaRef.current,
		[],
	);
	const latestValueRef = useRef(value);
	const lastSavedRef = useRef<string[]>(paths);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveInFlightRef = useRef(false);
	const queuedPathsRef = useRef<string[] | null>(null);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const retryDelayRef = useRef(RETRY_BASE_MS);

	const flushSaveRef = useRef<((next: string[]) => Promise<void>) | null>(null);

	const isMountedRef = useRef(true);

	const savedLines = toLines(paths);
	useEffect(() => {
		if (isFocused() || debounceTimerRef.current || saveInFlightRef.current) {
			return;
		}
		setValue(savedLines);
		latestValueRef.current = savedLines;
		lastSavedRef.current = toPaths(savedLines);
	}, [savedLines, isFocused]);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

			if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
		};
	}, []);

	const saveMutation = useMutation({
		mutationFn: (nextPaths: string[]) =>
			client.project.setSparseCheckoutPaths.mutate({
				projectId,
				paths: nextPaths,
			}),
	});

	const flushSave = useCallback(
		async (next: string[]) => {
			if (saveInFlightRef.current) {
				queuedPathsRef.current = next;
				return;
			}

			if (pathsEqual(next, lastSavedRef.current)) {
				setSaveStatus("idle");
				setInvalidMessage(null);
				if (retryTimerRef.current) {
					clearTimeout(retryTimerRef.current);
					retryTimerRef.current = null;
				}
				queuedPathsRef.current = null;
				return;
			}

			if (savedTimerRef.current) {
				clearTimeout(savedTimerRef.current);
				savedTimerRef.current = null;
			}

			setSaveStatus("saving");
			setInvalidMessage(null);
			saveInFlightRef.current = true;
			try {
				await saveMutation.mutateAsync(next);
				lastSavedRef.current = next;

				if (!isMountedRef.current) return;

				retryDelayRef.current = RETRY_BASE_MS;
				setSaveStatus("saved");
				savedTimerRef.current = setTimeout(() => {
					setSaveStatus("idle");
					savedTimerRef.current = null;
				}, SAVED_INDICATOR_MS);
				onChanged();
			} catch (err) {
				if (
					err instanceof TRPCClientError &&
					err.data?.code === "BAD_REQUEST"
				) {
					setSaveStatus("invalid");
					setInvalidMessage(err.message);
					console.warn("[sparse-checkout/save] rejected, not retrying", err);
				} else {
					setSaveStatus("error");
					console.warn("[sparse-checkout/save] failed, retrying", err);

					if (isMountedRef.current) {
						const delay = retryDelayRef.current;
						retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS);
						if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
						retryTimerRef.current = setTimeout(() => {
							retryTimerRef.current = null;

							if (!isMountedRef.current || saveInFlightRef.current) return;
							void flushSaveRef.current?.(toPaths(latestValueRef.current));
						}, delay);
					}
				}
			} finally {
				saveInFlightRef.current = false;

				const pending = queuedPathsRef.current;
				queuedPathsRef.current = null;
				if (pending && isMountedRef.current) {
					if (retryTimerRef.current) {
						clearTimeout(retryTimerRef.current);
						retryTimerRef.current = null;
					}
					void flushSave(pending);
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
				void flushSave(toPaths(latestValueRef.current));
			}, SAVE_DEBOUNCE_MS);
		},
		[flushSave],
	);

	const handleBlur = useCallback(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		void flushSave(toPaths(latestValueRef.current));
	}, [flushSave]);

	return (
		<div className="space-y-1.5">
			<Textarea
				ref={textareaRef}
				id="project-sparse-checkout"
				value={value}
				onChange={(e) => handleChange(e.target.value)}
				onBlur={handleBlur}
				placeholder={"apps/desktop\npackages/ui"}
				rows={3}
				spellCheck={false}
				className="font-mono text-sm resize-y min-h-[calc(3lh+1.125rem)]"
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
						<Trans>Couldn't save. Retrying…</Trans>
					</span>
				)}
				{saveStatus === "invalid" && (
					<span className="select-text cursor-text text-destructive">
						{invalidMessage ?? <Trans>Couldn't save</Trans>}
					</span>
				)}
			</div>
		</div>
	);
}
