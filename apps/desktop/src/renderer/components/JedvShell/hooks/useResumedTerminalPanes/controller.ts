import {
	type TerminalLayoutStore,
	workspacePaneAreas,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import {
	captureTerminalPanes,
	MAX_RESUME_PANES,
	type ReboundTerminalPane,
	rebindVerifiedTerminal,
} from "./rebind";

const MAX_ROUND = 8;
const CONCURRENCY = 2;
const ROUND_INTERVAL_MS = 1000;
const MAX_RETRY_MS = 30_000;
interface Candidate {
	terminalId: string;
	dueAt: number;
	attempts: number;
	hinted: boolean;
	lastStartedAt: number;
	abort?: AbortController;
	awaitingTerminalId?: string;
}
export interface ResumePaneReadiness {
	connected: boolean;
	sessionsReady: boolean;
	layoutReady: boolean;
	sessions: readonly TerminalSession[];
}
export function createResumedTerminalPaneController(input: {
	store: TerminalLayoutStore;
	workspaceId: string;
	isCurrent(): boolean;
	lookup(
		terminalId: string,
		signal: AbortSignal,
	): Promise<{ terminalId: string } | null>;
	onRebound?(result: ReboundTerminalPane): void;
	onError?(error: unknown): void;
	now?(): number;
	schedule?(callback: () => void, delay: number): () => void;
}) {
	const now = input.now ?? Date.now;
	const schedule =
		input.schedule ??
		((callback, delay) => {
			const timer = setTimeout(callback, delay);
			return () => clearTimeout(timer);
		});
	let enabled = false,
		disposed = false,
		epoch = 0,
		nextRoundAt = 0;
	let currentRound: symbol | null = null;
	let cancelTimer: (() => void) | null = null;
	let live = new Set<string>();
	const candidates = new Map<string, Candidate>();
	const current = () => !disposed && enabled && input.isCurrent();
	function clearTimer() {
		cancelTimer?.();
		cancelTimer = null;
	}
	function pause() {
		epoch++;
		clearTimer();
		currentRound = null;
		for (const candidate of candidates.values()) candidate.abort?.abort();
		candidates.clear();
	}
	function scan(force = false) {
		if (!current()) return;
		const opened = new Set(
			captureTerminalPanes(input.store).map(
				(location) => location.pane.data.terminalId,
			),
		);
		for (const [id, candidate] of candidates) {
			if (!opened.has(id) || (live.has(id) && !candidate.hinted)) {
				candidate.abort?.abort();
				candidates.delete(id);
			}
		}
		for (const id of opened) {
			if (live.has(id)) continue;
			const existing = candidates.get(id);
			if (!existing)
				candidates.set(id, {
					terminalId: id,
					attempts: 0,
					dueAt: now(),
					hinted: false,
					lastStartedAt: -Infinity,
				});
			else if (
				force ||
				(existing.awaitingTerminalId && live.has(existing.awaitingTerminalId))
			)
				existing.dueAt = Math.max(
					now(),
					existing.lastStartedAt + ROUND_INTERVAL_MS,
				);
		}
		arm();
	}
	function arm() {
		clearTimer();
		if (!current() || currentRound || !candidates.size) return;
		const due = Math.min(
			...[...candidates.values()]
				.filter((candidate) => !candidate.abort)
				.map((candidate) => candidate.dueAt),
		);
		if (!Number.isFinite(due)) return;
		cancelTimer = schedule(
			() => {
				cancelTimer = null;
				void pump();
			},
			Math.max(0, due - now(), nextRoundAt - now()),
		);
	}
	async function resolve(candidate: Candidate, capturedEpoch: number) {
		if (
			!current() ||
			epoch !== capturedEpoch ||
			candidates.get(candidate.terminalId) !== candidate
		)
			return;
		const captured = captureTerminalPanes(input.store).filter(
			(location) => location.pane.data.terminalId === candidate.terminalId,
		);
		if (!captured.length) {
			candidates.delete(candidate.terminalId);
			return;
		}
		const abort = new AbortController();
		candidate.abort = abort;
		candidate.lastStartedAt = now();
		candidate.attempts++;
		candidate.dueAt =
			now() +
			Math.min(MAX_RETRY_MS, 2000 * 2 ** Math.min(candidate.attempts - 1, 4));
		try {
			const successor = await input.lookup(candidate.terminalId, abort.signal);
			if (
				!current() ||
				epoch !== capturedEpoch ||
				abort.signal.aborted ||
				candidates.get(candidate.terminalId) !== candidate
			)
				return;
			candidate.hinted = false;
			if (successor?.terminalId) {
				if (!live.has(successor.terminalId)) {
					candidate.awaitingTerminalId = successor.terminalId;
					candidate.hinted = true;
					return;
				}
				candidate.awaitingTerminalId = undefined;
				const result = rebindVerifiedTerminal({
					store: input.store,
					previousTerminalId: candidate.terminalId,
					terminalId: successor.terminalId,
					captured,
				});
				if (result) {
					candidates.delete(candidate.terminalId);
					input.onRebound?.(result);
				}
			}
		} catch (error) {
			if (current() && epoch === capturedEpoch && !abort.signal.aborted)
				input.onError?.(error);
		} finally {
			if (candidate.abort === abort) candidate.abort = undefined;
		}
	}
	async function pump() {
		if (!current() || currentRound) return;
		if (now() < nextRoundAt) {
			arm();
			return;
		}
		const due = [...candidates.values()]
			.filter((candidate) => !candidate.abort && candidate.dueAt <= now())
			.sort((a, b) => a.dueAt - b.dueAt || a.lastStartedAt - b.lastStartedAt)
			.slice(0, MAX_ROUND);
		if (!due.length) {
			arm();
			return;
		}
		const round = Symbol(),
			capturedEpoch = epoch;
		currentRound = round;
		nextRoundAt = now() + ROUND_INTERVAL_MS;
		let index = 0;
		const worker = async () => {
			while (index < due.length && current() && epoch === capturedEpoch) {
				const candidate = due[index++];
				await resolve(candidate, capturedEpoch);
			}
		};
		try {
			await Promise.all(Array.from({ length: CONCURRENCY }, worker));
		} finally {
			if (currentRound === round) {
				currentRound = null;
				scan();
			}
		}
	}
	let scanQueued = false;
	const queueScan = () => {
		if (scanQueued) return;
		scanQueued = true;
		queueMicrotask(() => {
			scanQueued = false;
			scan();
		});
	};
	const pair = workspacePaneAreas(input.store);
	const unsubscribe = [pair.left, pair.right].map((area) =>
		area.subscribe((next, previous) => {
			if (next.tabs !== previous.tabs) queueScan();
		}),
	);
	return {
		update(readiness: ResumePaneReadiness) {
			if (disposed) return;
			const nextEnabled =
				readiness.connected && readiness.sessionsReady && readiness.layoutReady;
			live = new Set(readiness.sessions.map((session) => session.terminalId));
			if (!nextEnabled) {
				if (enabled) pause();
				enabled = false;
				return;
			}
			const resumed = !enabled;
			enabled = true;
			if (resumed) nextRoundAt = now();
			scan(resumed);
		},
		resumed(workspaceId: string, terminalId: string) {
			if (
				!current() ||
				workspaceId !== input.workspaceId ||
				!captureTerminalPanes(input.store).some(
					(location) => location.pane.data.terminalId === terminalId,
				)
			)
				return;
			if (!candidates.has(terminalId) && candidates.size >= MAX_RESUME_PANES) {
				scan();
				if (candidates.size >= MAX_RESUME_PANES) return;
			}
			const candidate = candidates.get(terminalId) ?? {
				terminalId,
				dueAt: now(),
				attempts: 0,
				hinted: false,
				lastStartedAt: -Infinity,
			};
			candidate.hinted = true;
			candidate.dueAt = Math.max(
				now(),
				candidate.lastStartedAt + ROUND_INTERVAL_MS,
			);
			candidates.set(terminalId, candidate);
			arm();
		},
		reconnected() {
			scan(true);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			enabled = false;
			pause();
			for (const off of unsubscribe) off();
		},
	};
}
