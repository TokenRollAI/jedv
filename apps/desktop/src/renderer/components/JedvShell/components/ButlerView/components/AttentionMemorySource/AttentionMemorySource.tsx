import type { AttentionSourceTarget } from "@jedv/shared/butler-attention";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { JedvParityViewContext } from "../../../../parity-types";
import { MemoryPanel } from "../../../MemoryPanel";
import type { MemoryScopeOption } from "../../../MemoryPanel/types";
export function AttentionMemorySource({
	source,
	context,
	onClose,
}: {
	source: AttentionSourceTarget;
	context: JedvParityViewContext;
	onClose(): void;
}) {
	const { t } = useLingui();
	const scopes: MemoryScopeOption[] = [];
	const team = useQuery({
		queryKey: ["jedv", context.hostUrl, "attention-memory-team", source.teamId],
		queryFn: () =>
			context.client.team.status.query({ teamId: source.teamId ?? "" }),
		enabled: !!source.teamId,
		retry: false,
		gcTime: 30_000,
	});
	if (source.projectId)
		scopes.push({
			scopeKind: "project",
			scopeId: source.projectId,
			label: t({ message: "Project" }),
		});
	if (source.teamId)
		scopes.push({
			scopeKind: "team",
			scopeId: source.teamId,
			label: t({ message: "Team" }),
		});
	scopes.push({
		scopeKind: "global",
		scopeId: "",
		label: t({ message: "Global" }),
	});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				aria-describedby={undefined}
				className="flex h-[min(80vh,640px)] min-h-0 flex-col sm:max-w-3xl"
			>
				<DialogHeader className="shrink-0">
					<DialogTitle>
						<Trans>Memory</Trans>
					</DialogTitle>
				</DialogHeader>
				{source.teamId && team.isError && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>Unavailable</Trans>
					</p>
				)}
				<MemoryPanel
					client={context.client}
					hostUrl={context.hostUrl}
					scopes={scopes}
					readOnly={!!source.teamId && team.data?.team.status === "archived"}
					disabled={!!source.teamId && (!team.isSuccess || team.isError)}
				/>
			</DialogContent>
		</Dialog>
	);
}
