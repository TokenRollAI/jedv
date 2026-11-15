import { FilesWorkspace } from "./components/FilesWorkspace/FilesWorkspace";
import type { JedvFilesViewProps } from "./props";

export function JedvFilesView(props: JedvFilesViewProps) {
	return (
		<FilesWorkspace
			key={`${props.context.hostUrl}:${props.workspaceId}`}
			{...props}
		/>
	);
}
