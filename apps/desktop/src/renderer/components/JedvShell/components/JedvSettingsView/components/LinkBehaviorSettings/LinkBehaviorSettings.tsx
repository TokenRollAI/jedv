import { useLingui } from "@lingui/react/macro";
import { useSettings } from "renderer/stores/settings";
import { FolderLinkTierMapper } from "./components/FolderLinkTierMapper";
import { LinkTierMapper } from "./components/LinkTierMapper";

export type LinkBehaviorSurface = "url" | "file" | "sidebarFile" | "folder";
export interface LinkBehaviorSettingsProps {
	surfaces?: readonly LinkBehaviorSurface[];
	rightPaneAvailable?: boolean;
}

export function LinkBehaviorSettings({
	surfaces = ["url", "file", "sidebarFile", "folder"],
	rightPaneAvailable = false,
}: LinkBehaviorSettingsProps) {
	const { t } = useLingui();
	const urlLinks = useSettings((state) => state.urlLinks);
	const fileLinks = useSettings((state) => state.fileLinks);
	const sidebarFileLinks = useSettings((state) => state.sidebarFileLinks);
	const folderLinks = useSettings((state) => state.folderLinks);
	const update = useSettings((state) => state.update);
	return (
		<div className="space-y-6">
			{surfaces.includes("url") && (
				<LinkTierMapper
					title={t({ message: "URL links" })}
					description={t({
						message:
							"Applies to URLs in Markdown previews and terminal output.",
					})}
					value={urlLinks}
					onChange={(next) => update("urlLinks", next)}
					idPrefix="jedv-links-url"
					surface="url"
					rightPaneAvailable={rightPaneAvailable}
				/>
			)}
			{surfaces.includes("file") && (
				<LinkTierMapper
					title={t({ message: "File links" })}
					description={t({
						message:
							"Applies to file paths in Markdown previews and terminal output.",
					})}
					value={fileLinks}
					onChange={(next) => update("fileLinks", next)}
					idPrefix="jedv-links-file"
					surface="file"
				/>
			)}
			{surfaces.includes("sidebarFile") && (
				<LinkTierMapper
					title={t({ message: "Sidebar file rows" })}
					description={t({
						message: "Applies to file rows in the workspace file tree.",
					})}
					value={sidebarFileLinks}
					onChange={(next) => update("sidebarFileLinks", next)}
					idPrefix="jedv-links-sidebar-file"
					surface="file"
				/>
			)}
			{surfaces.includes("folder") && (
				<FolderLinkTierMapper
					title={t({ message: "Folder links" })}
					description={t({
						message:
							"Applies to folder paths in Markdown previews, terminal output, and workspace file tree rows.",
					})}
					value={folderLinks}
					onChange={(next) => update("folderLinks", next)}
					idPrefix="jedv-links-folder"
				/>
			)}
		</div>
	);
}
