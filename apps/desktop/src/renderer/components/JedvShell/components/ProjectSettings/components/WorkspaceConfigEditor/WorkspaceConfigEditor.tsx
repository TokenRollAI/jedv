import { isMissingProcedureError } from "@jedv/shared/missing-procedure-error";
import { fromV1Json, toTomlText } from "@jedv/shared/project-config";
import { Button } from "@jedv/ui/button";
import { Skeleton } from "@jedv/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@jedv/ui/tabs";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { LocalClient } from "../../../../local-client";
import {
	ConfigFileEditor,
	type ConfigFileFormat,
} from "./components/ConfigFileEditor";
import { CONFIG_TEMPLATE, LOCAL_CONFIG_TEMPLATE } from "./constants";

interface WorkspaceConfigEditorProps {
	hostUrl: string;
	client: LocalClient;
	projectId: string;
}

type SaveTarget = {
	file: "shared" | "local";
	format: ConfigFileFormat;
	content: string;
};

function convertJsonToToml(content: string): string | null {
	try {
		return toTomlText(fromV1Json(JSON.parse(content)));
	} catch {
		return null;
	}
}

export function WorkspaceConfigEditor({
	hostUrl,
	client,
	projectId,
}: WorkspaceConfigEditorProps) {
	const queryClient = useQueryClient();
	const queryKey = ["host-config", "getConfigFiles", hostUrl, projectId];
	const [converted, setConverted] = useState<string | null>(null);

	const files = useQuery({
		queryKey,
		queryFn: () =>
			client.config.getConfigFiles.query({
				projectId,
			}),
		retry: (count, error) => !isMissingProcedureError(error) && count < 2,
	});

	const save = useMutation({
		mutationFn: (target: SaveTarget) =>
			client.config.writeConfigFile.mutate({
				projectId,
				...target,
			}),
		onSuccess: (_result, target) => {
			if (target.file === "shared") setConverted(null);
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	if (files.isLoading) return <Skeleton className="h-72 w-full" />;
	if (files.error) {
		return (
			<p className="text-sm text-muted-foreground">
				{isMissingProcedureError(files.error) ? (
					<Trans>Update Jedv on this host to edit its workspace config.</Trans>
				) : (
					files.error.message
				)}
			</p>
		);
	}
	if (!files.data) return null;

	const { shared, local, tomlPath } = files.data;
	const isJson = shared?.format === "json" && converted === null;
	const sharedFormat: ConfigFileFormat = isJson ? "json" : "toml";
	const savingFile = save.isPending ? save.variables?.file : null;
	const errorFor = (file: SaveTarget["file"]) =>
		save.error && save.variables?.file === file ? save.error.message : null;

	return (
		<Tabs defaultValue="shared" className="flex flex-col gap-3">
			<TabsList className="self-start">
				<TabsTrigger value="shared">
					<Trans>Shared</Trans>
				</TabsTrigger>
				<TabsTrigger value="local">
					<Trans>Personal</Trans>
				</TabsTrigger>
			</TabsList>
			<TabsContent
				value="shared"
				forceMount
				className="data-[state=inactive]:hidden"
			>
				<ConfigFileEditor
					path={isJson && shared ? shared.path : tomlPath}
					format={sharedFormat}
					savedContent={
						converted !== null
							? null
							: shared?.format === sharedFormat
								? shared.content
								: null
					}
					initialContent={CONFIG_TEMPLATE}
					pendingContent={converted}
					note={
						isJson ? (
							<Trans>
								This project still uses the older config.json. It keeps working;
								convert it to config.toml to use the new sections.
							</Trans>
						) : (
							<Trans>
								Committed with the repository and shared with everyone who works
								on it.
							</Trans>
						)
					}
					actions={
						isJson
							? (text) => (
									<Button
										size="sm"
										variant="outline"
										disabled={convertJsonToToml(text) === null}
										onClick={() => setConverted(convertJsonToToml(text))}
									>
										<Trans>Convert to config.toml</Trans>
									</Button>
								)
							: undefined
					}
					isSaving={savingFile === "shared"}
					saveError={errorFor("shared")}
					onSave={(content) =>
						save.mutate({ file: "shared", format: sharedFormat, content })
					}
				/>
			</TabsContent>
			<TabsContent
				value="local"
				forceMount
				className="data-[state=inactive]:hidden"
			>
				<ConfigFileEditor
					path={local.path}
					format="toml"
					savedContent={local.content}
					initialContent={LOCAL_CONFIG_TEMPLATE}
					note={
						<Trans>
							Only on this machine: gitignored, and applied to every worktree of
							this repository. Any key set here replaces the shared one.
						</Trans>
					}
					isSaving={savingFile === "local"}
					saveError={errorFor("local")}
					onSave={(content) =>
						save.mutate({ file: "local", format: "toml", content })
					}
				/>
			</TabsContent>
		</Tabs>
	);
}
