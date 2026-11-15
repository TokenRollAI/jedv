import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Label } from "@jedv/ui/label";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { LocalConnection } from "../../local-client";

export function PrivateConnectionDialog({
	onConnect,
	onClose,
}: {
	onConnect(connection: LocalConnection): Promise<void>;
	onClose(): void;
}) {
	const status =
		electronTrpc.hostServiceCoordinator.getTailscaleStatus.useQuery();
	const connect =
		electronTrpc.hostServiceCoordinator.connectPrivateHost.useMutation();
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pending = submitting || connect.isPending;
	const [baseUrl, setBaseUrl] = useState("");
	const [token, setToken] = useState("");
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				className="sm:max-w-md"
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Connect to host</Trans>
					</DialogTitle>
					<DialogDescription>Tailscale Serve · HTTPS · PSK</DialogDescription>
				</DialogHeader>
				<div
					className="space-y-1 text-xs text-muted-foreground"
					aria-live="polite"
				>
					<p>Tailscale · {status.data?.state ?? "…"}</p>
					{status.data?.dnsName && <p>{status.data.dnsName}</p>}
					{status.data?.health.map((message) => (
						<p key={message}>{message}</p>
					))}
					{status.error && <p>{status.error.message}</p>}
					<Button
						variant="ghost"
						size="sm"
						disabled={status.isFetching}
						onClick={() => void status.refetch()}
					>
						<Trans>Refresh</Trans>
					</Button>
				</div>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						setSubmitting(true);
						setError(null);
						try {
							const result = await connect.mutateAsync({ baseUrl, token });
							await onConnect({
								...result,
								secret: token,
								port: Number(new URL(result.baseUrl).port) || 443,
							});
							setToken("");
							onClose();
						} catch (cause) {
							setError(cause instanceof Error ? cause.message : String(cause));
						} finally {
							setSubmitting(false);
						}
					}}
				>
					<div className="space-y-2">
						<Label htmlFor="jedv-host-endpoint">
							<Trans>Endpoint</Trans>
						</Label>
						<Input
							id="jedv-host-endpoint"
							autoFocus
							placeholder="https://host.tailnet.ts.net"
							value={baseUrl}
							onChange={(event) => setBaseUrl(event.target.value)}
							disabled={pending}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="jedv-host-psk">PSK</Label>
						<Input
							id="jedv-host-psk"
							type="password"
							autoComplete="off"
							value={token}
							onChange={(event) => setToken(event.target.value)}
							disabled={pending}
							required
						/>
					</div>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							type="submit"
							disabled={pending || !baseUrl.trim() || !token}
						>
							<Trans>Connect</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
