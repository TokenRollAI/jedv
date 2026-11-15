import { Trans } from "@lingui/react/macro";

export interface ApprovalDetail {
	command?: string;
	cwd?: string;
	paths?: string[];
	reason?: string;
	permissions?: string[];
	redacted: boolean;
	truncated: boolean;
}

export function ApprovalPreview({ detail }: { detail?: ApprovalDetail }) {
	const available =
		detail &&
		(detail.command ||
			detail.cwd ||
			detail.paths?.length ||
			detail.reason ||
			detail.permissions?.length);
	return (
		<div className="min-w-0 space-y-2">
			<p className="font-medium">
				<Trans>Approval required</Trans>
			</p>
			{!available && (
				<p className="text-muted-foreground">
					<Trans>
						This host did not provide a readable preview. Review the request in
						the agent CLI before approving.
					</Trans>
				</p>
			)}
			{detail?.command && (
				<div>
					<p className="text-muted-foreground">
						<Trans>Command</Trans>
					</p>
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-xs">
						{detail.command}
					</pre>
				</div>
			)}
			{detail?.cwd && (
				<div>
					<p className="text-muted-foreground">
						<Trans>Working directory</Trans>
					</p>
					<p className="break-all font-mono">{detail.cwd}</p>
				</div>
			)}
			{!!detail?.paths?.length && (
				<div>
					<p className="text-muted-foreground">
						<Trans>Affected paths</Trans>
					</p>
					<ul className="max-h-32 overflow-auto font-mono">
						{detail.paths.map((path, index) => (
							<li className="break-all" key={`${index}:${path}`}>
								{path}
							</li>
						))}
					</ul>
				</div>
			)}
			{detail?.reason && (
				<p className="whitespace-pre-wrap break-words">{detail.reason}</p>
			)}
			{!!detail?.permissions?.length && (
				<div>
					<p className="text-muted-foreground">
						<Trans>Requested permissions</Trans>
					</p>
					<ul>
						{detail.permissions.map((permission, index) => (
							<li className="break-words" key={`${index}:${permission}`}>
								{permission}
							</li>
						))}
					</ul>
				</div>
			)}
			{detail?.redacted && (
				<p className="text-muted-foreground">
					<Trans>
						Sensitive values are hidden. This preview is incomplete.
					</Trans>
				</p>
			)}
			{detail?.truncated && (
				<p className="text-muted-foreground">
					<Trans>
						This preview was shortened. Review the full request in the agent
						CLI.
					</Trans>
				</p>
			)}
		</div>
	);
}
