import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Trans } from "@lingui/react/macro";
import { ThemeSwatch } from "renderer/components/ThemeSwatch";
import { SYSTEM_THEME_ID } from "renderer/stores/theme";
import type { Theme } from "shared/themes";
import { useSettingsSearchQuery } from "../../../../hooks/useSettingsSearch";
import { HighlightText } from "../../../HighlightText";
import { ThemeOptionRow } from "../ThemeOptionRow/ThemeOptionRow";

interface ThemeRowProps {
	disabled?: boolean;
	label: string;
	hint: React.ReactNode;
	value: string;
	onValueChange: (value: string) => void;
	currentTheme: Theme;
	options: ReadonlyArray<{ group: string; themes: Theme[] }>;
	includeSystem?: {
		darkTheme: Theme;
		lightTheme: Theme;
	};
}
export function ThemeRow({
	disabled,
	label,
	hint,
	value,
	onValueChange,
	currentTheme,
	options,
	includeSystem,
}: ThemeRowProps) {
	const isSystem = includeSystem !== undefined && value === SYSTEM_THEME_ID;
	const searchQuery = useSettingsSearchQuery();
	return (
		<div className="flex items-center justify-between gap-6 p-4">
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium">
					<HighlightText text={label} query={searchQuery} />
				</div>
				<div className="text-xs text-muted-foreground">
					{typeof hint === "string" ? (
						<HighlightText text={hint} query={searchQuery} />
					) : (
						hint
					)}
				</div>
			</div>
			<Select disabled={disabled} value={value} onValueChange={onValueChange}>
				<SelectTrigger size="sm" className="w-auto min-w-44 px-2">
					<SelectValue>
						{isSystem ? (
							<div className="flex items-center gap-2 min-w-0">
								<div className="flex shrink-0 -space-x-1">
									<ThemeSwatch theme={includeSystem.lightTheme} />
									<ThemeSwatch theme={includeSystem.darkTheme} />
								</div>
								<span className="truncate text-xs">
									<Trans>System</Trans>
								</span>
							</div>
						) : (
							<div className="flex items-center gap-2 min-w-0">
								<ThemeSwatch theme={currentTheme} />
								<span className="truncate text-xs">{currentTheme.name}</span>
							</div>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent className="max-h-[320px]">
					{includeSystem && (
						<>
							<SelectItem value={SYSTEM_THEME_ID}>
								<div className="flex items-center gap-2 min-w-0">
									<div className="flex shrink-0 -space-x-1">
										<ThemeSwatch theme={includeSystem.lightTheme} />
										<ThemeSwatch theme={includeSystem.darkTheme} />
									</div>
									<span className="truncate">
										<Trans>System</Trans>
									</span>
								</div>
							</SelectItem>
							<SelectSeparator />
						</>
					)}
					{options.map((group, idx) => (
						<SelectGroup key={group.group}>
							{idx > 0 && <SelectSeparator />}
							<SelectLabel className="text-xs text-muted-foreground">
								{group.group}
							</SelectLabel>
							{group.themes.map((theme) => (
								<SelectItem key={theme.id} value={theme.id}>
									<ThemeOptionRow theme={theme} />
								</SelectItem>
							))}
						</SelectGroup>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
