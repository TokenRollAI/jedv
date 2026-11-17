import {
	getAgentEfforts,
	getAgentModelSupport,
} from "@jedv/shared/agent-models";
import { Button } from "@jedv/ui/button";
import { Label } from "@jedv/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { LuSlidersHorizontal } from "react-icons/lu";
import { JedvSelect } from "../../../JedvSelect";
export interface TaskConfiguration {
	name: string;
	model: string;
	effort: string;
}
export function TaskOptions({
	presetId,
	value,
	disabled,
	onChange,
}: {
	presetId: string;
	value: TaskConfiguration;
	disabled: boolean;
	onChange(value: TaskConfiguration): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const models = getAgentModelSupport(presetId)?.models ?? [];
	const efforts = getAgentEfforts(presetId, value.model || undefined);
	if (!models.length && !efforts.length) return null;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
					disabled={disabled}
					aria-label={t({ message: "More options" })}
					title={t({ message: "More options" })}
				>
					<LuSlidersHorizontal className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 space-y-3">
				{!!models.length && (
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-model`} className="text-xs">
							<Trans>Model</Trans>
						</Label>
						<JedvSelect
							id={`${id}-model`}
							label={t({ message: "Model" })}
							value={value.model}
							disabled={disabled}
							onValueChange={(model) =>
								onChange({ ...value, model, effort: "" })
							}
							options={[
								{ value: "", label: t({ message: "Default" }) },
								...models.map((model) => ({
									value: model.id,
									label: model.label,
								})),
							]}
							className="h-8 w-full"
						/>
					</div>
				)}
				{!!efforts.length && (
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-effort`} className="text-xs">
							<Trans>Effort</Trans>
						</Label>
						<JedvSelect
							id={`${id}-effort`}
							label={t({ message: "Effort" })}
							value={value.effort}
							disabled={disabled}
							onValueChange={(effort) => onChange({ ...value, effort })}
							options={[
								{ value: "", label: t({ message: "Default" }) },
								...efforts.map((effort) => ({
									value: effort.id,
									label: effort.label,
								})),
							]}
							className="h-8 w-full"
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
