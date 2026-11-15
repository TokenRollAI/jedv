import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useRef, useState } from "react";
import type { WorkspaceSortMode } from "../../../../project-tree";
import { SortableWorkspaceRow } from "../SortableWorkspaceRow";
export function SortableWorkspaceList({
	workspaceIds,
	sortMode,
	filtered,
	available = true,
	onReorder,
	renderRow,
}: {
	workspaceIds: string[];
	sortMode: WorkspaceSortMode;
	filtered: boolean;
	available?: boolean;
	onReorder(fullScopeIds: string[]): Promise<void>;
	renderRow(id: string): ReactNode;
}) {
	const { t } = useLingui();
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const disabled = !available || filtered || sortMode !== "manual" || pending;
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	return (
		<div>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={async (event) => {
					if (
						disabled ||
						busy.current ||
						!event.over ||
						event.active.id === event.over.id
					)
						return;
					const from = workspaceIds.indexOf(String(event.active.id));
					const to = workspaceIds.indexOf(String(event.over.id));
					if (from < 0 || to < 0) return;
					busy.current = true;
					setPending(true);
					setError(null);
					try {
						await onReorder(arrayMove(workspaceIds, from, to));
					} catch {
						setError(
							t({
								message:
									"Could not save workspace order. The list may have changed on the host; refresh and try again.",
							}),
						);
					} finally {
						busy.current = false;
						setPending(false);
					}
				}}
			>
				<SortableContext
					items={workspaceIds}
					strategy={verticalListSortingStrategy}
				>
					{workspaceIds.map((id) => (
						<SortableWorkspaceRow key={id} id={id} disabled={disabled}>
							{renderRow(id)}
						</SortableWorkspaceRow>
					))}
				</SortableContext>
			</DndContext>
			{error && (
				<p role="alert" className="mx-4 py-1 text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
