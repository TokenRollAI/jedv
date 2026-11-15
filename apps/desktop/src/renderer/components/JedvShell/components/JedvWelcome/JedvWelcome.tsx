import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuFolderOpen } from "react-icons/lu";
import jedvLogo from "renderer/assets/jedv-logo.svg";
import {
	WindowChrome,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { GitEnvironmentNotice } from "./components/GitEnvironmentNotice";
import { ImportFromOtherTools } from "./components/ImportFromOtherTools";
import { StepHeader } from "./components/StepHeader";
import { StepShell } from "./components/StepShell";
import { WelcomePreferences } from "./components/WelcomePreferences";
import type { JedvWelcomeProps } from "./types";

export function JedvWelcome({
	context,
	onComplete,
	onOpenProject,
	onImported,
}: JedvWelcomeProps) {
	const { t } = useLingui();
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const complete = async () => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await onComplete();
		} catch {
			setError(t({ message: "Could not save your progress. Try again." }));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Welcome to Jedv" })}
		>
			<WindowChrome>
				<WindowChromeLeading leftmost expand={false} />
				<div className="drag flex-1" />
				<WindowControlsInset />
			</WindowChrome>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<StepShell>
					<StepHeader
						icon={<img src={jedvLogo} alt="" className="size-12" />}
						title={t({ message: "Welcome to Jedv" })}
						subtitle={t({ message: "Choose a project to start working." })}
					/>
					<WelcomePreferences />
					<GitEnvironmentNotice enabled={!!context && !context.isRemote} />
					<Button
						className="h-auto min-h-10 whitespace-normal py-2"
						disabled={!context || pending}
						onClick={() => onOpenProject("open")}
					>
						<LuFolderOpen className="size-4 shrink-0" />
						<Trans>Choose a project</Trans>
					</Button>
					{context && (
						<p
							className="-mt-3 truncate text-center text-xs text-muted-foreground"
							title={context.hostLabel}
						>
							{context.hostLabel}
						</p>
					)}
					<ImportFromOtherTools
						context={context}
						onImported={async (result) => {
							await onImported?.(result);
							await onComplete();
						}}
					/>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<Button
						variant="ghost"
						className="self-center text-xs text-muted-foreground"
						disabled={pending}
						onClick={() => void complete()}
					>
						{pending ? <Trans>Saving…</Trans> : <Trans>Set up later</Trans>}
					</Button>
				</StepShell>
			</div>
		</section>
	);
}
