import { Label } from "@jedv/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Trans } from "@lingui/react/macro";
import { useCallback } from "react";
import { modifierLabel } from "renderer/components/JedvShell/components/JedvFilesView/utils/clickPolicy/modifierLabel";
import { folderIntentLabel } from "renderer/components/JedvShell/components/JedvFilesView/utils/clickPolicy/policies/folderPolicy";
import type {
	FolderLinkAction,
	FolderTierMap,
	LinkTier,
} from "renderer/components/JedvShell/components/JedvFilesView/utils/link-policy/types";
import { useSettingsSearchQuery } from "../../../../hooks/useSettingsSearch";
import { HighlightText } from "../../../HighlightText";

type SlotValue = FolderLinkAction | "none";

const TIERS: LinkTier[] = ["plain", "shift", "meta", "metaShift"];
const ACTIONS: FolderLinkAction[] = ["reveal", "external", "finder"];

function toSlot(action: FolderLinkAction | null): SlotValue {
	return action ?? "none";
}

function fromSlot(slot: SlotValue): FolderLinkAction | null {
	return slot === "none" ? null : slot;
}

export interface FolderLinkTierMapperProps {
	title: string;
	description: string;
	value: FolderTierMap;
	onChange: (next: FolderTierMap) => void;
	idPrefix: string;
}

export function FolderLinkTierMapper({
	title,
	description,
	value,
	onChange,
	idPrefix,
}: FolderLinkTierMapperProps) {
	const searchQuery = useSettingsSearchQuery();
	const pick = useCallback(
		(tier: LinkTier, nextSlot: SlotValue) => {
			const nextAction = fromSlot(nextSlot);
			if (value[tier] === nextAction) return;
			onChange({ ...value, [tier]: nextAction });
		},
		[value, onChange],
	);

	return (
		<div>
			<h3 className="text-sm font-medium mb-1">
				<HighlightText text={title} query={searchQuery} />
			</h3>
			<p className="text-xs text-muted-foreground mb-3">
				<HighlightText text={description} query={searchQuery} />
			</p>
			<div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
				{TIERS.map((tier) => {
					const id = `${idPrefix}-${tier}`;
					return (
						<div
							key={tier}
							className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/30 transition-colors"
						>
							<Label htmlFor={id} className="text-sm font-medium capitalize">
								{modifierLabel(tier)}
							</Label>
							<Select
								value={toSlot(value[tier])}
								onValueChange={(v) => pick(tier, v as SlotValue)}
							>
								<SelectTrigger
									id={id}
									size="sm"
									className="w-60 max-w-full shrink-0"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										<Trans>Do nothing</Trans>
									</SelectItem>
									{ACTIONS.map((action) => (
										<SelectItem key={action} value={action}>
											{folderIntentLabel(action)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					);
				})}
			</div>
		</div>
	);
}
