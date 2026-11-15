import { Input } from "@jedv/ui/input";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { LocalClient } from "../../../../local-client";
export function NameSection({
	projectId,
	currentName,
	hostUrl,
	client,
	canRename,
	onRenamed,
}: {
	projectId: string;
	currentName: string;
	hostUrl: string | null;
	client: LocalClient;
	canRename: boolean;
	onRenamed?: () => void;
}) {
	const { t } = useLingui();
	const [value, setValue] = useState(currentName);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const cancelled = useRef(false);
	useEffect(() => {
		setValue(currentName);
	}, [currentName]);
	const commit = async () => {
		if (
			busy.current ||
			cancelled.current ||
			!canRename ||
			!hostUrl ||
			value.trim() === currentName
		)
			return;
		if (!value.trim()) {
			setError(t({ message: "Enter a project name." }));
			return;
		}
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await client.project.update.mutate({ projectId, name: value.trim() });
			onRenamed?.();
		} catch {
			setError(
				t({
					message: "Could not rename project. Your draft is kept; try again.",
				}),
			);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<div className="space-y-1">
			<Input
				id="project-name"
				aria-label={t({ message: "Project name" })}
				aria-invalid={!!error}
				value={value}
				disabled={!canRename || pending}
				onFocus={() => {
					cancelled.current = false;
				}}
				onChange={(event) => {
					setValue(event.target.value);
					setError(null);
				}}
				onBlur={() => void commit()}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						!event.nativeEvent.isComposing &&
						event.nativeEvent.keyCode !== 229
					) {
						event.preventDefault();
						void commit();
					}
					if (event.key === "Escape") {
						cancelled.current = true;
						setValue(currentName);
						setError(null);
						event.currentTarget.blur();
					}
				}}
			/>
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
