import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import type { Project } from "../../../types";
import { IconUploadField } from "../IconUploadField";
import { resolveProjectIconUrl } from "../project-icon";
import type { ProjectActionContext } from "../types";

export function ProjectAppearanceDialog({
	project,
	context,
	onUpdated,
	onClose,
}: {
	project: Project;
	context: ProjectActionContext;
	onUpdated?(context: ProjectActionContext): Promise<void>;
	onClose(): void;
}) {
	const [preview, setPreview] = useState(project);
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-[420px]">
				<DialogHeader>
					<DialogTitle>
						<Trans>Project icon and color</Trans>
					</DialogTitle>
					<DialogDescription>{project.name}</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-3">
					<IconUploadField
						projectId={project.id}
						projectName={project.name}
						client={context.client}
						iconUrl={resolveProjectIconUrl(preview)}
						hasCustomIcon={!!preview.icon && preview.icon !== "none"}
						isIconRemoved={preview.icon === "none"}
						color={preview.color}
						onUpdated={async () => {
							const projects = await context.client.project.list.query();
							const updated = projects.find((item) => item.id === project.id);
							if (updated) setPreview(updated);
							await onUpdated?.(context);
						}}
					/>
					<p className="text-xs text-muted-foreground">
						<Trans>
							Choose a glyph, upload an image, or change the accent color.
						</Trans>
					</p>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						<Trans>Done</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
