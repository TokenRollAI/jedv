import { ThemeSwatch } from "renderer/components/ThemeSwatch";
import type { Theme } from "shared/themes";
export function ThemeOptionRow({ theme }: { theme: Theme }) {
	return (
		<div className="flex items-center gap-2 min-w-0">
			<ThemeSwatch theme={theme} />
			<span className="truncate">{theme.name}</span>
		</div>
	);
}
