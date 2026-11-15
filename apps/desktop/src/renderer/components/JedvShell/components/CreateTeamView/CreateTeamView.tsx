import { PromptInputProvider } from "@jedv/ui/ai-elements/prompt-input";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuUsers } from "react-icons/lu";
import type { useTeamwork } from "../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../parity-types";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { TeamTaskComposer } from "./components/TeamTaskComposer/TeamTaskComposer";
export interface CreateTeamViewProps {
	context: JedvParityViewContext;
	index: ReturnType<typeof useTeamwork>;
	connected: boolean;
	initialWorkspaceId?: string | null;
	onCreated(id: string): void;
}
export function CreateTeamView(props: CreateTeamViewProps) {
	const { t } = useLingui();
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Create team" })}
		>
			<WindowChrome primary className="border-b border-border pr-3">
				<WindowChromeLeading />
				<WindowChromeControls className="pl-3">
					<h1 className="flex items-center gap-2 text-[13px] font-medium">
						<LuUsers className="size-4 text-muted-foreground" />
						<Trans>Create team</Trans>
					</h1>
				</WindowChromeControls>
				<div className="drag min-w-0 flex-1" />
				<WindowControlsInset />
			</WindowChrome>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-10 lg:px-12 lg:py-20">
				<PromptInputProvider>
					<TeamTaskComposer {...props} />
				</PromptInputProvider>
			</div>
		</section>
	);
}
