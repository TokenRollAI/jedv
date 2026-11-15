import {
	type PeerSummary,
	peerUpsertSchema,
} from "@jedv/shared/teamwork-peers";
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
import { Switch } from "@jedv/ui/switch";
import { Trans } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import type { z } from "zod";
export function PeerEditor({
	initial,
	onSave,
	onClose,
}: {
	initial?: PeerSummary;
	onSave(value: z.input<typeof peerUpsertSchema>): Promise<void>;
	onClose(): void;
}) {
	const id = useId();
	const busy = useRef(false);
	const [peerId, setPeerId] = useState(initial?.id ?? ""),
		[name, setName] = useState(initial?.name ?? ""),
		[origin, setOrigin] = useState(initial?.origin ?? ""),
		[token, setToken] = useState(""),
		[enabled, setEnabled] = useState(initial?.enabled ?? true),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	const candidate = peerUpsertSchema.safeParse({
		id: peerId.trim(),
		name: name.trim(),
		origin: origin.trim(),
		enabled,
		...(token ? { outboundToken: token } : {}),
	});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!pending}
				onInteractOutside={(e) => {
					if (pending) e.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{initial ? <Trans>Edit peer</Trans> : <Trans>Add peer</Trans>}
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Mail-only access. The host administration key is never shared.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!candidate.success || busy.current) return;
						busy.current = true;
						setPending(true);
						setError(false);
						try {
							await onSave(candidate.data);
							onClose();
						} catch {
							setError(true);
						} finally {
							setToken("");
							busy.current = false;
							setPending(false);
						}
					}}
				>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-id`} className="text-xs">
							<Trans>Peer host ID</Trans>
						</Label>
						<Input
							id={`${id}-id`}
							value={peerId}
							onChange={(e) => setPeerId(e.target.value)}
							maxLength={128}
							disabled={pending || !!initial}
							className="h-8 font-mono text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-name`} className="text-xs">
							<Trans>Name</Trans>
						</Label>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={120}
							disabled={pending}
							className="h-8 text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-origin`} className="text-xs">
							<Trans>HTTPS address</Trans>
						</Label>
						<Input
							id={`${id}-origin`}
							type="url"
							value={origin}
							onChange={(e) => setOrigin(e.target.value)}
							maxLength={2048}
							disabled={pending}
							placeholder="https://my-host.tailnet.ts.net"
							className="h-8 text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-token`} className="text-xs">
							<Trans>Outbound mail token</Trans>
						</Label>
						<Input
							id={`${id}-token`}
							type="password"
							autoComplete="new-password"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							maxLength={256}
							disabled={pending}
							placeholder={initial?.outboundTokenHint ?? ""}
							className="h-8 font-mono text-xs"
						/>
					</div>
					<div className="flex items-center justify-between">
						<Label htmlFor={`${id}-enabled`} className="text-xs">
							<Trans>Enabled</Trans>
						</Label>
						<Switch
							id={`${id}-enabled`}
							checked={enabled}
							disabled={pending}
							onCheckedChange={setEnabled}
						/>
					</div>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							<Trans>Operation failed</Trans>
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={pending}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							type="submit"
							size="sm"
							disabled={pending || !candidate.success}
						>
							<Trans>Save</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
