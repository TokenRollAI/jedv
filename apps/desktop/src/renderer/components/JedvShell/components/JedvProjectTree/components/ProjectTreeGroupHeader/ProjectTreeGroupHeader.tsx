import { useLingui } from "@lingui/react/macro";
import {
	LuArrowDown,
	LuArrowUp,
	LuChevronRight,
	LuPencil,
	LuRotateCcw,
} from "react-icons/lu";
import { JedvRowMenu } from "../../../JedvRowMenu";
import type { TreeGroup } from "../../utils/tree-layout";
export function ProjectTreeGroupHeader({
	name,
	group,
	count,
	collapsed,
	disabled,
	canMoveUp,
	canMoveDown,
	onToggle,
	onEdit,
	onMove,
	onReset,
}: {
	name: string;
	group?: TreeGroup;
	count: number;
	collapsed: boolean;
	disabled: boolean;
	canMoveUp?: boolean;
	canMoveDown?: boolean;
	onToggle(): void;
	onEdit(): void;
	onMove(direction: -1 | 1): void;
	onReset(): void;
}) {
	const { t } = useLingui();
	const content = (
		<button
			type="button"
			className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded pl-6 pr-7 text-left text-[11px] text-muted-foreground hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
			onClick={onToggle}
			aria-expanded={!collapsed}
			disabled={disabled}
		>
			<LuChevronRight
				className={`size-3 shrink-0 ${collapsed ? "" : "rotate-90"}`}
			/>
			{group?.color && /^#[0-9a-f]{6}$/i.test(group.color) && (
				<span
					className="size-1.5 shrink-0 rounded-full"
					style={{ backgroundColor: group.color }}
				/>
			)}
			<span className="truncate" title={name}>
				{name}
			</span>
			<span className="ml-auto tabular-nums">{count}</span>
		</button>
	);
	return group ? (
		<JedvRowMenu
			className="mx-2 h-6 rounded"
			actions={[
				{
					label: t({ message: "Edit group" }),
					icon: <LuPencil className="size-4" />,
					disabled,
					run: onEdit,
				},
				{
					label: t({ message: "Move group up" }),
					icon: <LuArrowUp className="size-4" />,
					disabled: disabled || !canMoveUp,
					run: () => onMove(-1),
				},
				{
					label: t({ message: "Move group down" }),
					icon: <LuArrowDown className="size-4" />,
					disabled: disabled || !canMoveDown,
					run: () => onMove(1),
				},
				{
					label: t({ message: "Reset group appearance" }),
					icon: <LuRotateCcw className="size-4" />,
					disabled,
					separator: true,
					run: onReset,
				},
			]}
		>
			{content}
		</JedvRowMenu>
	) : (
		<div className="mx-2">{content}</div>
	);
}
