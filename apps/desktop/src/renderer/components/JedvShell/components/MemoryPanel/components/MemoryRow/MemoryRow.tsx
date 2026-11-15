import { useLingui } from "@lingui/react/macro";
import {
	LuCheck,
	LuPencil,
	LuPin,
	LuSparkles,
	LuTrash2,
	LuX,
} from "react-icons/lu";
import { JedvIconButton } from "../../../JedvIconButton";
import type { MemoryItem } from "../../types";
export function MemoryRow({
	item,
	disabled,
	onEdit,
	onRemove,
	onReview,
}: {
	item: MemoryItem;
	disabled: boolean;
	onEdit(): void;
	onRemove(): void;
	onReview(action: "accept" | "reject"): void;
}) {
	const { t } = useLingui();
	const candidate = item.status === "candidate";
	const source =
		item.sourceKind === "human"
			? t({ message: "Human" })
			: item.sourceKind === "agent"
				? t({ message: "Agent" })
				: item.sourceKind === "watchdog"
					? "WatchDog"
					: "Butler";
	return (
		<article className="space-y-2 border-b border-border py-3">
			<div className="flex min-w-0 items-start gap-2">
				<span
					className={`mt-1 shrink-0 ${candidate ? "text-warning" : "text-muted-foreground"}`}
				>
					{candidate ? (
						<LuSparkles
							className="size-3"
							aria-label={t({ message: "Candidate" })}
						/>
					) : (
						<LuPin
							className="size-3"
							aria-label={
								item.tier === "core"
									? t({ message: "Core" })
									: t({ message: "Archival" })
							}
						/>
					)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="break-words text-xs font-medium">{item.title}</p>
					<p className="mt-2 whitespace-pre-wrap break-words text-xs text-foreground/80">
						{item.content}
					</p>
					<p
						className={`mt-2 text-[10px] ${candidate ? "text-warning" : "text-muted-foreground"}`}
						title={item.sourceRef ?? undefined}
					>
						{source}
						{candidate ? ` · ${t({ message: "Awaiting review" })}` : ""}
					</p>
				</div>
				<div className="flex shrink-0 gap-0.5">
					{candidate ? (
						<>
							<JedvIconButton
								label={t({ message: "Accept candidate" })}
								disabled={disabled}
								onClick={() => onReview("accept")}
							>
								<LuCheck className="size-3.5" />
							</JedvIconButton>
							<JedvIconButton
								label={t({ message: "Reject candidate" })}
								disabled={disabled}
								onClick={() => onReview("reject")}
							>
								<LuX className="size-3.5" />
							</JedvIconButton>
						</>
					) : (
						<>
							<JedvIconButton
								label={t({ message: "Edit memory" })}
								disabled={disabled}
								onClick={onEdit}
							>
								<LuPencil className="size-3.5" />
							</JedvIconButton>
							<JedvIconButton
								label={t({ message: "Remove memory" })}
								disabled={disabled}
								onClick={onRemove}
							>
								<LuTrash2 className="size-3.5" />
							</JedvIconButton>
						</>
					)}
				</div>
			</div>
		</article>
	);
}
