import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { Ellipsis } from "lucide-react";
import { useRef } from "react";
import {
	VscGitCommit,
	VscGitPullRequestCreate,
	VscRepoPush,
} from "react-icons/vsc";
export type ShipView = "commit" | "push" | "pr";
export function ShipActionsMenu({
	canCommit,
	canPush,
	canCreatePr,
	onOpen,
}: {
	canCommit: boolean;
	canPush: boolean;
	canCreatePr: boolean;
	onOpen(view: ShipView): void;
}) {
	const { t } = useLingui();
	const next = useRef<ShipView | null>(null);
	if (!canCommit && !canPush && !canCreatePr) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={t({ message: "More actions" })}
					className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent data-[state=open]:bg-accent"
				>
					<Ellipsis className="size-4" strokeWidth={1.5} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-56"
				onCloseAutoFocus={(event) => {
					if (!next.current) return;
					event.preventDefault();
					const view = next.current;
					next.current = null;
					onOpen(view);
				}}
			>
				{canCommit && (
					<DropdownMenuItem
						onSelect={() => {
							next.current = "commit";
						}}
					>
						<VscGitCommit className="size-4" />
						<Trans>Commit</Trans>
					</DropdownMenuItem>
				)}
				{canPush && (
					<DropdownMenuItem
						onSelect={() => {
							next.current = "push";
						}}
					>
						<VscRepoPush className="size-4" />
						<Trans>Push</Trans>
					</DropdownMenuItem>
				)}
				{canCreatePr && (
					<DropdownMenuItem
						onSelect={() => {
							next.current = "pr";
						}}
					>
						<VscGitPullRequestCreate className="size-4" />
						<Trans>Create PR</Trans>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
