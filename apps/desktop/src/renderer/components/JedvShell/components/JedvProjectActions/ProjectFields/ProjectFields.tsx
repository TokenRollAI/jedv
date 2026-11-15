import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Label } from "@jedv/ui/label";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { LuFolderOpen } from "react-icons/lu";

export function ProjectFields({
	name,
	parentDir,
	disabled,
	onName,
	onParent,
	onBrowse,
	autoFocusName = true,
}: {
	name: string;
	parentDir: string;
	disabled: boolean;
	onName(name: string): void;
	onParent(path: string): void;
	onBrowse(): void;
	autoFocusName?: boolean;
}) {
	const { t } = useLingui();
	const id = useId();
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-name`} className="text-xs">
					<Trans>Project name</Trans>
				</Label>
				<Input
					id={`${id}-name`}
					value={name}
					onChange={(e) => onName(e.target.value)}
					placeholder="my-project"
					disabled={disabled}
					autoFocus={autoFocusName}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-location`} className="text-xs">
					<Trans>Location</Trans>
				</Label>
				<div className="flex gap-1.5">
					<Input
						id={`${id}-location`}
						value={parentDir}
						onChange={(e) => onParent(e.target.value)}
						disabled={disabled}
						className="min-w-0 flex-1 font-mono text-xs"
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={disabled}
						onClick={onBrowse}
						aria-label={t({ message: "Browse for directory" })}
					>
						<LuFolderOpen className="size-4" />
					</Button>
				</div>
			</div>
		</>
	);
}
