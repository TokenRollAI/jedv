import type { ReactNode } from "react";
import { useSettingsSearchQuery } from "../../hooks/useSettingsSearch";
import { HighlightText } from "../HighlightText";
export function SettingRow({
	label,
	description,
	children,
	error,
}: {
	label: string;
	description?: string;
	children: ReactNode;
	error?: string;
}) {
	const query = useSettingsSearchQuery();
	if (
		query &&
		!`${label} ${description ?? ""}`
			.toLocaleLowerCase()
			.includes(query.toLocaleLowerCase())
	)
		return null;
	return (
		<div className="flex flex-wrap items-center justify-between gap-4 p-4">
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium">
					<HighlightText text={label} query={query} />
				</div>
				{description && (
					<p className="text-xs text-muted-foreground">
						<HighlightText text={description} query={query} />
					</p>
				)}
				{error && (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{error}
					</p>
				)}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}
