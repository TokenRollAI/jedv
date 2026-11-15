import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { PickerTrigger } from "renderer/components/PickerTrigger";
import type { ProjectActionKind } from "../JedvProjectActions";
export function JedvHostMenu({
	host,
	connected,
	onLocal,
	onConnect,
	onRestart,
}: {
	host: string;
	connected: boolean;
	onLocal(): void;
	onConnect(): void;
	onRestart(): void;
	onProjectAction(kind: ProjectActionKind): void;
}) {
	const { t } = useLingui();

	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<PickerTrigger
						label={host}
						endAdornment={
							<span
								title={
									connected
										? t({ message: "Connected" })
										: t({ message: "Disconnected" })
								}
								className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-success" : "bg-destructive"}`}
							/>
						}
						className="h-7 flex-1"
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onSelect={onLocal}>
						<Trans>This device</Trans> · <Trans>Local</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={onConnect}>
						<Trans>Connect to host</Trans>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={onRestart}>
						<Trans>Restart Local Host</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
