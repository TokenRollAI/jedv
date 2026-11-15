import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuGripVertical } from "react-icons/lu";
export function SortableWorkspaceRow({
	id,
	disabled,
	children,
}: {
	id: string;
	disabled: boolean;
	children: ReactNode;
}) {
	const { t } = useLingui();
	const sortable = useSortable({ id, disabled });
	return (
		<div
			ref={sortable.setNodeRef}
			style={{
				transform: CSS.Transform.toString(sortable.transform),
				transition: sortable.transition,
			}}
			className={`group/workspace-sort relative ${sortable.isDragging ? "z-10 opacity-70" : ""}`}
		>
			{children}
			{!disabled && (
				<button
					ref={sortable.setActivatorNodeRef}
					type="button"
					aria-label={t({ message: "Reorder workspace" })}
					className="absolute left-2 top-1.5 z-10 grid size-4 touch-none place-items-center rounded text-muted-foreground opacity-0 hover:bg-fill-hover focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/workspace-sort:opacity-100"
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<LuGripVertical className="size-3" />
				</button>
			)}
		</div>
	);
}
