import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuArrowLeft, LuExternalLink } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { TemplateCard } from "../TemplateCard";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "../templates";

export function TemplateGallery({
	selectedId,
	disabled,
	onSelect,
	onBack,
}: {
	selectedId: string | null;
	disabled: boolean;
	onSelect(template: ProjectTemplate): void;
	onBack(): void;
}) {
	const { i18n } = useLingui();
	const selected = PROJECT_TEMPLATES.find((item) => item.id === selectedId);
	return selected ? (
		<div className="flex flex-col gap-3">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="self-start"
				disabled={disabled}
				onClick={onBack}
			>
				<LuArrowLeft className="size-4" />
				<Trans>All templates</Trans>
			</Button>
			<div className="flex items-start gap-3">
				<selected.icon className="mt-1 size-6 shrink-0" />
				<div className="min-w-0">
					<h3 className="text-sm font-medium">{selected.name}</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						{i18n._(selected.description)}
					</p>
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-auto max-w-full justify-start px-0 py-2 text-xs"
						onClick={() => {
							if (selected.repo)
								void electronTrpcClient.external.openUrl.mutate(selected.repo);
						}}
					>
						<span className="truncate">
							<Trans>View source</Trans>
						</span>
						<LuExternalLink className="size-3 shrink-0" />
					</Button>
					<p className="break-all font-mono text-[11px] text-muted-foreground">
						{selected.repo}
					</p>
				</div>
			</div>
		</div>
	) : (
		<div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:grid-cols-3">
			{PROJECT_TEMPLATES.map((template) => (
				<TemplateCard
					key={template.id}
					template={template}
					cloning={false}
					disabled={disabled}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}
