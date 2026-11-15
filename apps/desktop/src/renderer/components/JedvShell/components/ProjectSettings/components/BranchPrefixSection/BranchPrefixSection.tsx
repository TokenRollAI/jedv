import { errorMessage } from "@jedv/i18n/errors";
import type { BranchPrefixMode } from "@jedv/shared/workspace-launch";
import { toast } from "@jedv/ui/sonner";
import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import type { LocalClient } from "../../../../local-client";
import { BranchPrefixControl } from "../BranchPrefixControl";

interface BranchPrefixSectionProps {
	projectId: string;
	hostUrl: string;
	client: LocalClient;
	mode: BranchPrefixMode | null;
	customPrefix: string | null;
	onChanged: () => void;
}

export function BranchPrefixSection({
	projectId,
	client,
	mode,
	customPrefix,
	onChanged,
}: BranchPrefixSectionProps) {
	const { t } = useLingui();
	const setMutation = useMutation({
		mutationFn: (vars: {
			mode: BranchPrefixMode | null;
			customPrefix: string | null;
		}) =>
			client.project.setBranchPrefix.mutate({
				projectId,
				...vars,
			}),
		onSuccess: () => onChanged(),
		onError: (err) =>
			toast.error(
				errorMessage(
					err,
					t({
						message: "Failed to update branch prefix",
					}),
				),
			),
	});

	return (
		<BranchPrefixControl
			mode={mode}
			customPrefix={customPrefix}
			showDefault
			disabled={setMutation.isPending}
			onChange={(next) => setMutation.mutate(next)}
		/>
	);
}
