import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { LuChevronDown, LuChevronRight, LuNotebookPen } from "react-icons/lu";
import type { LocalClient } from "../../../../local-client";
import { MemoryPanel } from "../../../MemoryPanel";
export function ProjectMemorySection({
	client,
	hostUrl,
	projectId,
	projectName,
}: {
	client: LocalClient;
	hostUrl: string;
	projectId: string;
	projectName: string;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const contentId = useId();
	return (
		<section className="space-y-3 border-t pt-6">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={contentId}
				className="flex w-full items-center gap-2 rounded text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => setOpen(!open)}
			>
				<LuNotebookPen className="size-4 text-muted-foreground" />
				<Trans>Project memory</Trans>
				{open ? (
					<LuChevronDown className="ml-auto size-3.5" />
				) : (
					<LuChevronRight className="ml-auto size-3.5" />
				)}
			</button>
			<div id={contentId}>
				{open && (
					<div className="flex h-[480px] min-h-0 flex-col">
						<MemoryPanel
							client={client}
							hostUrl={hostUrl}
							scopes={[
								{
									scopeKind: "project",
									scopeId: projectId,
									label: `${t({ message: "Project" })} · ${projectName}`,
								},
								{
									scopeKind: "global",
									scopeId: "",
									label: t({ message: "Global" }),
								},
							]}
						/>
					</div>
				)}
			</div>
		</section>
	);
}
