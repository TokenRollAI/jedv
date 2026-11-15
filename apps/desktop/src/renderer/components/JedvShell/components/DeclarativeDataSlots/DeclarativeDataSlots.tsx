import { safeExternalUrlSchema } from "@jedv/shared/declarative-slots";
import { Badge } from "@jedv/ui/badge";
import { toast } from "@jedv/ui/sonner";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { LuArrowUpRight } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { JedvParityViewContext } from "../../parity-types";
import { JedvIconButton } from "../JedvIconButton";
export function DeclarativeDataSlots({
	context,
	surface,
	teamId,
	connected,
}: {
	context: Pick<JedvParityViewContext, "client" | "hostUrl">;
	surface: "teamwork.header" | "sidebar.panel";
	teamId?: string;
	connected: boolean;
}) {
	const { t } = useLingui();
	const key = ["jedv", context.hostUrl, "declarativeSlots"];
	const capabilities = useQuery({
		queryKey: [...key, "capabilities"],
		queryFn: () => context.client.declarativeSlots.capabilities.query(),
		enabled: connected,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 60_000,
	});
	const supported =
		capabilities.data?.protocolVersion === 1 && !capabilities.isError;
	const views = useQuery({
		queryKey: [...key, "view", surface, teamId ?? null],
		queryFn: () =>
			context.client.declarativeSlots.resolveView.query({
				surface,
				...(teamId ? { teamId } : {}),
			}),
		enabled: connected && supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 15_000,
	});
	if (!connected || !supported || views.isError || !views.data?.length)
		return null;
	if (surface === "teamwork.header")
		return (
			<div className="no-drag flex min-w-0 max-w-[45%] items-center gap-1 overflow-x-auto">
				{views.data.slice(0, 20).flatMap((view) =>
					view.items.map((item, i) => (
						<Badge
							key={`${view.extensionId}:${i}`}
							variant="secondary"
							className="max-w-48 text-[10px]"
							title={`${view.name} · ${item.label}: ${item.text}`}
						>
							<span className="truncate">
								{item.label}: {item.text}
							</span>
						</Badge>
					)),
				)}
			</div>
		);
	return (
		<section
			className="space-y-2 p-3"
			aria-label={t({ message: "Sidebar extensions" })}
		>
			{views.data.slice(0, 20).map((view) => (
				<section
					key={view.extensionId}
					className="space-y-2 rounded-lg border border-sidebar-border p-3"
				>
					<header className="flex min-w-0 items-center gap-1">
						<h3
							className="min-w-0 flex-1 truncate text-xs font-medium"
							title={view.name}
						>
							{view.title ?? view.name}
						</h3>
						{view.url && safeExternalUrlSchema.safeParse(view.url).success && (
							<JedvIconButton
								label={t({ message: "Open link" })}
								className="size-6"
								onClick={() =>
									void electronTrpcClient.external.openUrl
										.mutate(view.url ?? "")
										.catch(() =>
											toast.error(t({ message: "Operation failed" })),
										)
								}
							>
								<LuArrowUpRight className="size-3.5" />
							</JedvIconButton>
						)}
					</header>
					<dl className="space-y-1">
						{view.items.map((item, i) => (
							<div
								key={`${item.label}:${i}`}
								className={
									view.cardType === "kv_list"
										? "flex min-w-0 justify-between gap-2 text-[11px]"
										: "min-w-0 text-[11px]"
								}
							>
								<dt
									className="truncate text-muted-foreground"
									title={item.label}
								>
									{item.label}
								</dt>
								<dd className="truncate" title={item.text}>
									{item.text}
								</dd>
							</div>
						))}
					</dl>
				</section>
			))}
		</section>
	);
}
