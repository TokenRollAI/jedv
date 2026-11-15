import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { JedvParityViewContext } from "../../../../parity-types";
import {
	DeletedProjectsPanel,
	ProjectSettings,
	type ProjectSettingsContext,
} from "../../../ProjectSettings";

export function ProjectSettingsSection(context: JedvParityViewContext) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const [selection, setSelection] = useState<string | null>(null);
	const selected =
		context.projects.find((project) => project.id === selection) ??
		context.projects[0];
	const refresh = async (original: ProjectSettingsContext) => {
		await cache.invalidateQueries({
			queryKey: ["jedv", original.hostUrl, "projects"],
		});
		await cache.invalidateQueries({
			queryKey: ["jedv", original.hostUrl, "workspaces"],
		});
	};
	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-sm font-medium">
					<Trans>Project settings</Trans>
				</h3>
				{selected && (
					<Select value={selected.id} onValueChange={setSelection}>
						<SelectTrigger
							className="w-56"
							size="sm"
							aria-label={t({ message: "Choose a project" })}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{context.projects.map((project) => (
								<SelectItem value={project.id} key={project.id}>
									{project.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>
			{selected ? (
				<div className="rounded-lg border border-border">
					<ProjectSettings
						key={`${context.hostUrl}:${selected.id}`}
						context={context}
						projectId={selected.id}
						onChanged={refresh}
					/>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					<Trans>No projects on this host.</Trans>
				</p>
			)}
			<DeletedProjectsPanel
				key={context.hostUrl}
				context={context}
				onChanged={refresh}
			/>
		</section>
	);
}
