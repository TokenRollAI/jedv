import type { AttentionGroupShape } from "@jedv/shared/butler-attention";
import { useLingui } from "@lingui/react/macro";
export function useAttentionTitle(
	group: Pick<AttentionGroupShape, "kind" | "activeCount"> | null,
) {
	const { t } = useLingui();
	if (!group) return "";
	const activeCount = group.activeCount;
	switch (group.kind) {
		case "mail_unacked":
			return activeCount > 0
				? t({ message: `Mail awaiting acknowledgement: ${activeCount}` })
				: t({ message: "Team mail" });
		case "team_attention":
			return activeCount > 0
				? t({ message: "Member status needs checking" })
				: t({ message: "Member status" });
		case "suspected_stalled":
			return activeCount > 0
				? t({ message: "Member activity needs checking" })
				: t({ message: "Member activity" });
		case "automation_failed":
			return activeCount > 0
				? t({ message: `Failed runs: ${activeCount}` })
				: t({ message: "Automations" });
	}
}
