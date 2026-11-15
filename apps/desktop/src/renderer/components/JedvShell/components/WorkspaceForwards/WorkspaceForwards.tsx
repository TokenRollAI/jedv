import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
} from "@jedv/ui/popover";
import { toast } from "@jedv/ui/sonner";
import { getEventBus } from "@jedv/workspace-client";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { LocalClient } from "../../local-client";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../JedvConfirmDialog/JedvConfirmDialog";
import { PortRow } from "./components/PortRow/PortRow";
import { PortsCountIcon } from "./components/PortsCountIcon/PortsCountIcon";
import type { WorkspacePortRowData } from "./types";
export function WorkspaceForwards({
	client,
	hostUrl,
	workspaceId,
	remote,
	getWsToken,
	onOpenUrl,
	openRef,
	anchorRef,
	inline = false,
	portsSnapshot,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	remote: boolean;
	getWsToken?: () => string | null;
	onOpenUrl?(url: string): Promise<void>;
	openRef?: RefObject<(() => void) | null>;
	anchorRef?: RefObject<HTMLButtonElement | null>;
	inline?: boolean;
	portsSnapshot?: WorkspacePortRowData[];
}) {
	const { t } = useLingui(),
		{ copyToClipboard } = useCopyToClipboard();
	const key = `${hostUrl}:${workspaceId}`,
		current = useRef<string | null>(key);
	current.current = key;
	const [port, setPort] = useState("");
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (!openRef) return;
		const show = () => setOpen(true);
		openRef.current = show;
		return () => {
			if (openRef.current === show) openRef.current = null;
		};
	}, [openRef]);
	const [pending, setPending] = useState<number | null>(null);
	const pendingRef = useRef(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const detected = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "ports"],
		queryFn: () => client.ports.getAll.query({ workspaceIds: [workspaceId] }),
		retry: false,
		enabled: !inline || open,
		refetchInterval: !inline || open ? 2000 : false,
	});
	const forwards = electronTrpc.portForwards.list.useQuery(undefined, {
		refetchInterval: 2000,
	});
	useEffect(() => {
		current.current = key;
		setErrors({});
		setPort("");
		setPending(null);
		setConfirmation(null);
		return () => {
			if (current.current === key) current.current = null;
		};
	}, [key]);
	useEffect(() => {
		if (!getWsToken) return;
		const bus = getEventBus(hostUrl, getWsToken),
			release = bus.retain();
		const off = bus.on(
			"port:changed",
			workspaceId,
			() => void detected.refetch(),
		);
		return () => {
			off();
			release();
		};
	}, [hostUrl, workspaceId, getWsToken, detected.refetch]);
	const rows =
		forwards.data?.filter(
			(row) =>
				row.target.hostUrl === hostUrl &&
				row.target.workspaceId === workspaceId,
		) ?? [];
	const ports = open
		? (detected.data ?? portsSnapshot ?? [])
		: (portsSnapshot ?? detected.data ?? []);
	const act = async (
		action:
			| "open"
			| "external"
			| "copy"
			| "kill"
			| "forward"
			| "stop"
			| "retry"
			| "stop-local",
		item: Pick<WorkspacePortRowData, "port" | "terminalId" | "processName">,
	) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(item.port);
		setErrors((previous) =>
			Object.fromEntries([
				...Object.entries(previous).slice(-63),
				[String(item.port), ""],
			]),
		);
		try {
			let forward = rows.find((row) => row.target.remotePort === item.port);
			if (action === "kill") {
				const result = await client.ports.kill.mutate({
					workspaceId,
					terminalId: item.terminalId,
					port: item.port,
				});
				if (!result.success)
					throw new Error(
						result.error ?? t({ message: "Failed to close port" }),
					);
			}
			if (action === "stop-local" && forward) {
				const result =
					await electronTrpcClient.portForwards.killLocalOwner.mutate({
						id: forward.id,
					});
				if (!result.success)
					throw new Error(result.error ?? t({ message: "Could not stop it" }));
			}
			if (action === "stop" && forward)
				await electronTrpcClient.portForwards.stopForward.mutate({
					id: forward.id,
				});
			if (
				action === "forward" ||
				(remote &&
					(action === "open" || action === "external" || action === "copy") &&
					forward?.status.state !== "active")
			) {
				const result = await electronTrpcClient.portForwards.forward.mutate({
					hostUrl,
					workspaceId,
					remotePort: item.port,
				});
				forward = result.find(
					(row) =>
						row.target.hostUrl === hostUrl &&
						row.target.workspaceId === workspaceId &&
						row.target.remotePort === item.port,
				);
			}
			if (action === "retry" && forward)
				await electronTrpcClient.portForwards.retryEphemeral.mutate({
					id: forward.id,
				});
			if (action === "open" || action === "external" || action === "copy") {
				if (remote && forward?.status.state !== "active")
					throw new Error(
						forward?.status.state === "error"
							? forward.status.message
							: t({ message: "Port forwarding is not active" }),
					);
				const localPort =
					remote && forward?.status.state === "active"
						? forward.status.localPort
						: item.port;
				const url = `http://127.0.0.1:${localPort}`;
				if (current.current === key) {
					if (action === "copy") {
						await copyToClipboard(url);
						toast.success(t({ message: "URL copied" }));
					} else if (action === "external") {
						await electronTrpcClient.external.openUrl.mutate(url);
						setOpen(false);
					} else if (onOpenUrl) {
						await onOpenUrl(url);
						setOpen(false);
					} else {
						await electronTrpcClient.external.openUrl.mutate(url);
						setOpen(false);
					}
				}
			}
		} catch (error) {
			if (current.current === key)
				setErrors((previous) => ({
					...previous,
					[item.port]: error instanceof Error ? error.message : String(error),
				}));
		} finally {
			pendingRef.current = false;
			if (current.current === key) {
				setPending(null);
				void detected.refetch();
				void forwards.refetch();
			}
		}
	};
	const request = (
		action: Parameters<typeof act>[0],
		item: Pick<WorkspacePortRowData, "port" | "terminalId" | "processName">,
	) => {
		if (action !== "kill" && action !== "stop-local") {
			void act(action, item);
			return;
		}
		if (action === "stop-local") {
			const forward = rows.find((row) => row.target.remotePort === item.port);
			if (forward?.status.state !== "busy" || !forward.status.localOwner)
				return;
			const owner = forward.status.localOwner;
			setOpen(false);
			setConfirmation({
				title: t({ message: "Stop local process?" }),
				description: t({
					message: "This stops the local process occupying the forwarded port.",
				}),
				detail: `127.0.0.1:${forward.status.localPort}\n${owner.pid} · ${owner.processName}\n${owner.workspaceId}\n${owner.terminalId}`,
				execute: () => act("stop-local", item),
			});
			return;
		}
		setOpen(false);
		setConfirmation({
			title: t({ message: "Close port?" }),
			description: t({
				message: "This stops the process listening on this port.",
			}),
			detail: `${hostUrl}\n${workspaceId}\n${item.port} · ${item.processName}\n${item.terminalId}`,
			execute: () => act(action, item),
		});
	};
	const stale = rows.filter(
		(row) => !ports.some((item) => item.port === row.target.remotePort),
	);
	if (
		!remote &&
		!ports.length &&
		!rows.length &&
		!detected.error &&
		!forwards.error
	)
		return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			{anchorRef && (
				<PopoverAnchor
					virtualRef={{
						current: {
							getBoundingClientRect: () =>
								anchorRef.current?.getBoundingClientRect() ?? new DOMRect(),
						},
					}}
				/>
			)}
			{(ports.length > 0 ||
				rows.length > 0 ||
				detected.error ||
				forwards.error) && (
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label={t({ message: "Ports" })}
						className={inline ? "h-[18px] rounded px-1" : "h-7 px-2"}
					>
						<PortsCountIcon count={ports.length} />
					</Button>
				</PopoverTrigger>
			)}
			<PopoverContent
				align="end"
				sideOffset={6}
				className="w-80 max-w-[calc(100vw-1rem)] p-0"
			>
				<div className="border-b px-3 py-2">
					<p className="text-xs font-medium">
						<Trans>Ports</Trans>
					</p>
				</div>
				{detected.isPending && (
					<p className="px-3 py-2 text-xs">
						<Trans>Loading…</Trans>
					</p>
				)}
				{detected.error && (
					<p role="alert" className="px-3 py-2 text-xs text-destructive">
						{detected.error.message}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void detected.refetch()}
						>
							<Trans>Retry</Trans>
						</Button>
					</p>
				)}
				{!ports.length &&
					!stale.length &&
					!detected.isPending &&
					!detected.error && (
						<p className="px-3 py-3 text-xs text-muted-foreground">
							<Trans>
								No ports yet. Start a dev server in a terminal and it shows up
								here.
							</Trans>
						</p>
					)}
				<div className="max-h-80 overflow-y-auto p-1">
					{ports.map((item) => (
						<PortRow
							key={`${item.terminalId}:${item.port}`}
							port={item}
							remote={remote}
							forward={rows.find((row) => row.target.remotePort === item.port)}
							pending={pending === item.port}
							error={errors[item.port]}
							onAction={(action) => request(action, item)}
						/>
					))}
				</div>
				{stale.map((row) => (
					<div key={row.id} className="border-t px-3 py-2 text-xs">
						<p>
							{row.target.remotePort} ·{" "}
							<Trans>Not detected in the workspace right now</Trans>
						</p>
						{row.status.state === "error" && (
							<p role="alert">{row.status.message}</p>
						)}
						{row.status.state === "active" && (
							<>
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										void act("open", {
											port: row.target.remotePort,
											terminalId: "",
											processName: "",
										})
									}
								>
									<Trans>Open</Trans>
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										void act("copy", {
											port: row.target.remotePort,
											terminalId: "",
											processName: "",
										})
									}
								>
									<Trans>Copy</Trans>
								</Button>
							</>
						)}
						<Button
							variant="ghost"
							size="sm"
							disabled={pending !== null}
							onClick={() =>
								void act("forward", {
									port: row.target.remotePort,
									terminalId: "",
									processName: "",
								})
							}
						>
							<Trans>Retry</Trans>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={pending !== null}
							onClick={() =>
								void act("stop", {
									port: row.target.remotePort,
									terminalId: "",
									processName: "",
								})
							}
						>
							<Trans>Stop forwarding</Trans>
						</Button>
						{errors[row.target.remotePort] && (
							<p role="alert">{errors[row.target.remotePort]}</p>
						)}
					</div>
				))}
				{ports.length > 0 && (
					<div className="flex items-center justify-between border-t px-3 py-2 text-xs">
						<span>
							<Trans>{ports.length} live ports</Trans>
						</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={pending !== null}
							onClick={() =>
								setConfirmation({
									title: t({ message: "Close all ports?" }),
									description: t({
										message:
											"This stops the processes listening on the listed workspace ports.",
									}),
									detail: ports
										.map((item) => `${item.port} · ${item.processName}`)
										.join("\n"),
									execute: async () => {
										for (const item of ports) {
											if (current.current !== key) break;
											await act("kill", item);
										}
									},
								})
							}
						>
							<Trans>Close all</Trans>
						</Button>
					</div>
				)}
				{remote && (
					<form
						className="flex gap-2 border-t p-2"
						onSubmit={(event) => {
							event.preventDefault();
							const value = Number(port);
							if (Number.isInteger(value) && value >= 1 && value <= 65535)
								void act("forward", {
									port: value,
									terminalId: "",
									processName: "",
								});
						}}
					>
						<Input
							aria-label={t({ message: "Remote port" })}
							type="number"
							min={1}
							max={65535}
							required
							value={port}
							onChange={(event) => setPort(event.target.value)}
							className="h-7 w-28"
						/>
						<Button
							size="sm"
							variant="outline"
							disabled={pending !== null || !port}
							type="submit"
						>
							<Trans>Forward</Trans>
						</Button>
					</form>
				)}
				{forwards.error && (
					<p role="alert" className="p-2 text-xs text-destructive">
						{forwards.error.message}
					</p>
				)}
			</PopoverContent>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => {
						setConfirmation(null);
						setOpen(true);
					}}
				/>
			)}
		</Popover>
	);
}
