import { Button } from "@jedv/ui/button";
import { Checkbox } from "@jedv/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
	LuArrowUp,
	LuFolder,
	LuLoaderCircle,
	LuRefreshCw,
} from "react-icons/lu";
import { joinProjectPath } from "../project-utils";
import type { ProjectActionContext } from "../types";

export function HostDirectoryPicker({
	context,
	initialPath,
	onSelect,
	onClose,
}: {
	context: ProjectActionContext;
	initialPath?: string;
	onSelect(path: string): void;
	onClose(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const [path, setPath] = useState(initialPath ?? "");
	const [requested, setRequested] = useState(initialPath || undefined);
	const [hidden, setHidden] = useState(false);
	const query = useQuery({
		queryKey: ["jedv", context.hostUrl, "project-directory", requested, hidden],
		queryFn: () =>
			context.client.filesystem.browseHost.query({
				path: requested,
				includeHidden: hidden,
			}),
		retry: false,
	});
	const data = query.data;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Select directory</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Target host: {context.hostLabel}</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const next = path.trim() || undefined;
						if (next === requested) void query.refetch();
						else setRequested(next);
					}}
				>
					<Input
						aria-label={t({ message: "Directory path" })}
						value={path}
						onChange={(event) => setPath(event.target.value)}
						placeholder={data?.path ?? "~/"}
					/>
					<Button type="submit" variant="outline">
						<Trans>Go</Trans>
					</Button>
				</form>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						disabled={!data?.parentPath || query.isFetching}
						aria-label={t({ message: "Parent directory" })}
						onClick={() => {
							setRequested(data?.parentPath ?? undefined);
							setPath(data?.parentPath ?? "");
						}}
					>
						<LuArrowUp className="size-4" />
					</Button>
					<span className="min-w-0 flex-1 break-all text-xs text-muted-foreground">
						{data?.path}
					</span>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t({ message: "Refresh" })}
						onClick={() => void query.refetch()}
					>
						<LuRefreshCw className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setPath("");
							setRequested(undefined);
						}}
					>
						<Trans>Home</Trans>
					</Button>
				</div>
				<div
					className="h-64 overflow-auto rounded border"
					aria-busy={query.isFetching}
				>
					{query.isPending ? (
						<output className="flex items-center gap-2 p-3 text-xs">
							<LuLoaderCircle className="size-4 animate-spin" />
							<Trans>Loading directories…</Trans>
						</output>
					) : query.isError ? (
						<div role="alert" className="p-3 text-xs text-destructive">
							<Trans>
								Could not read this directory. Check the path and permissions on
								the target host.
							</Trans>
						</div>
					) : (
						<>
							{data?.entries
								.filter((entry) => entry.isDirectory || entry.isSymlink)
								.map((entry) => (
									<button
										type="button"
										key={entry.name}
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
										onClick={() => {
											const next = joinProjectPath(data.path, entry.name);
											setPath(next);
											setRequested(next);
										}}
									>
										<LuFolder className="size-4 shrink-0" />
										<span className="break-all">{entry.name}</span>
									</button>
								))}
							{data?.entries.filter(
								(entry) => entry.isDirectory || entry.isSymlink,
							).length === 0 && (
								<p className="p-3 text-xs text-muted-foreground">
									<Trans>No subdirectories</Trans>
								</p>
							)}
						</>
					)}
				</div>
				<label htmlFor={id} className="flex items-center gap-2 text-xs">
					<Checkbox
						id={id}
						checked={hidden}
						onCheckedChange={(value) => setHidden(value === true)}
					/>
					<Trans>Show hidden directories</Trans>
				</label>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={!data || query.isFetching || query.isError}
						onClick={() => {
							if (data) onSelect(data.path);
						}}
					>
						<Trans>Select directory</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
