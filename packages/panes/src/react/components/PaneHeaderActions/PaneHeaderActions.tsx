import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { useLingui } from "@lingui/react/macro";
import { Fragment } from "react";
import type { PaneActionConfig, RendererContext } from "../../types";
import { resolvePaneActionLabel } from "./utils";

export function PaneHeaderActions<TData>({
	actions,
	context,
}: {
	actions: PaneActionConfig<TData>[];
	context: RendererContext<TData>;
}) {
	const { t } = useLingui();
	const fallbacks = {
		splitRight: t({ message: "Split right" }),
		splitDown: t({ message: "Split down" }),
		close: t({ message: "Close pane" }),
	};
	return (
		<div className="flex shrink-0 items-center gap-1">
			{actions.map((action, _index) => {
				const icon =
					typeof action.icon === "function"
						? action.icon(context)
						: action.icon;
				const tooltip =
					typeof action.tooltip === "function"
						? action.tooltip(context)
						: action.tooltip;
				const label = resolvePaneActionLabel(
					action,
					context,
					tooltip,
					fallbacks,
				);

				const button = (
					<button
						type="button"
						aria-label={label}
						title={label}
						onClick={() => action.onClick(context)}
						className="inline-flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						{icon}
					</button>
				);

				if (tooltip == null) {
					return <Fragment key={action.key}>{button}</Fragment>;
				}

				return (
					<Tooltip key={action.key} delayDuration={1000}>
						<TooltipTrigger asChild>{button}</TooltipTrigger>
						<TooltipContent side="bottom">{tooltip}</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
