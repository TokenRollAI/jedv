import { type Decision, type Item, isKnownItem } from "@jedv/chat/protocol";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
export function RunOutputItem({
	item,
	pending,
	canControl,
	onApprove,
}: {
	item: Item;
	pending: boolean;
	canControl: boolean;
	onApprove(decision: Decision): void;
}) {
	const { t } = useLingui();
	const [values, setValues] = useState<Record<string, string | string[]>>({});
	if (!isKnownItem(item))
		return (
			<details className="rounded-md border border-border/50 p-2 text-xs">
				<summary>{item.kind}</summary>
				<pre className="overflow-auto whitespace-pre-wrap">
					{JSON.stringify(item, null, 2)}
				</pre>
			</details>
		);
	if (item.kind === "approval_request")
		return (
			<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
				<div className="font-medium">{item.title}</div>
				{item.reason && (
					<p className="mt-1 whitespace-pre-wrap text-muted-foreground">
						{item.reason}
					</p>
				)}
				{item.detail?.map((part) => (
					<pre
						key={`${part.type}:${JSON.stringify(part)}`}
						className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono"
					>
						{part.type === "text"
							? part.text
							: part.type === "terminal"
								? `${part.command}\n${part.output}`
								: `${part.path}\n${part.newText}`}
					</pre>
				))}
				{item.status === "pending" ? (
					<fieldset
						disabled={pending || !canControl}
						className="mt-3 space-y-2"
					>
						{!canControl && (
							<p className="text-muted-foreground">
								<Trans>
									This session is not active, or you are viewing earlier output.
									Refresh to check its current state.
								</Trans>
							</p>
						)}
						{item.form ? (
							<form
								onSubmit={(e) => {
									e.preventDefault();
									onApprove({ type: "form", values });
								}}
							>
								<p>{item.form.message}</p>
								{item.form.fields.map((field) => (
									<label
										key={field.id}
										htmlFor={`approval-${item.id}-${field.id}`}
										className="mt-2 block"
									>
										{field.title ?? field.id}
										{field.description && (
											<span className="block text-muted-foreground">
												{field.description}
											</span>
										)}
										{field.options ? (
											<select
												id={`approval-${item.id}-${field.id}`}
												multiple={field.input === "multi"}
												required={field.required}
												value={
													values[field.id] ??
													(field.input === "multi" ? [] : "")
												}
												onChange={(e) =>
													setValues((v) => ({
														...v,
														[field.id]:
															field.input === "multi"
																? Array.from(e.target.selectedOptions).map(
																		(o) => o.value,
																	)
																: e.target.value,
													}))
												}
												className="mt-1 w-full rounded-md border border-input bg-background p-1.5 text-xs"
											>
												{field.input !== "multi" && (
													<option value="">
														{t({ message: "Select an option" })}
													</option>
												)}
												{field.options.map((o) => (
													<option key={o.value} value={o.value}>
														{o.label}
													</option>
												))}
											</select>
										) : field.input === "boolean" ? (
											<select
												id={`approval-${item.id}-${field.id}`}
												required={field.required}
												value={values[field.id] ?? ""}
												onChange={(e) =>
													setValues((v) => ({
														...v,
														[field.id]: e.target.value,
													}))
												}
												className="mt-1 w-full rounded-md border border-input bg-background p-1.5"
											>
												<option value="">
													{t({ message: "Select an option" })}
												</option>
												<option value="true">{t({ message: "Yes" })}</option>
												<option value="false">{t({ message: "No" })}</option>
											</select>
										) : (
											<Input
												id={`approval-${item.id}-${field.id}`}
												type={
													field.input === "number" || field.input === "integer"
														? "number"
														: "text"
												}
												step={field.input === "integer" ? 1 : "any"}
												required={field.required}
												value={values[field.id] ?? ""}
												onChange={(e) =>
													setValues((v) => ({
														...v,
														[field.id]: e.target.value,
													}))
												}
												className="mt-1 h-7 text-xs"
											/>
										)}
									</label>
								))}
								<Button type="submit" size="sm" className="mt-3 h-7">
									<Trans>Submit response</Trans>
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="ml-2 h-7"
									onClick={() => onApprove({ type: "cancel" })}
								>
									<Trans>Cancel</Trans>
								</Button>
							</form>
						) : (
							<div className="flex flex-wrap gap-2">
								{item.options?.length ? (
									item.options.map((option) => (
										<Button
											key={option.optionId}
											size="sm"
											variant={
												option.kind?.startsWith("reject")
													? "outline"
													: "secondary"
											}
											className="h-7 text-xs"
											onClick={() =>
												onApprove({ type: "option", optionId: option.optionId })
											}
										>
											{option.label}
										</Button>
									))
								) : (
									<>
										<Button
											size="sm"
											variant="outline"
											className="h-7 text-xs"
											onClick={() => onApprove({ type: "decline" })}
										>
											<Trans>Reject</Trans>
										</Button>
										<Button
											size="sm"
											className="h-7 text-xs"
											onClick={() => onApprove({ type: "accept" })}
										>
											<Trans>Allow</Trans>
										</Button>
									</>
								)}
							</div>
						)}
					</fieldset>
				) : (
					<p className="mt-2 text-muted-foreground">
						{item.status === "answered" ? (
							<Trans>Answered</Trans>
						) : (
							<Trans>Approval expired</Trans>
						)}
					</p>
				)}
			</div>
		);
	if (item.kind === "user_message")
		return (
			<div className="whitespace-pre-wrap rounded-lg border border-border/50 px-3 py-2 text-xs text-muted-foreground">
				{item.content
					.map((part) =>
						part.type === "text" && !part.hidden
							? part.text
							: part.type === "attachment"
								? part.name
								: "",
					)
					.join("\n")}
			</div>
		);
	if (item.kind === "agent_message" || item.kind === "notice")
		return (
			<p className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed">
				{item.text}
			</p>
		);
	if (item.kind === "reasoning")
		return (
			<details className="text-xs text-muted-foreground">
				<summary>
					<Trans>Reasoning</Trans>
				</summary>
				<p className="whitespace-pre-wrap">{item.summary ?? item.text}</p>
			</details>
		);
	if (item.kind === "plan")
		return (
			<ul className="space-y-1 text-xs">
				{item.entries.map((entry) => (
					<li key={entry.text} className="flex gap-2">
						<span>
							{entry.status === "completed"
								? "✓"
								: entry.status === "in_progress"
									? "●"
									: "○"}
						</span>
						{entry.text}
					</li>
				))}
			</ul>
		);
	return (
		<details className="rounded-lg border border-border/50 px-3 py-2 text-xs">
			<summary className="cursor-pointer">
				{item.title}{" "}
				<span className="text-muted-foreground">
					·{" "}
					{
						{
							running: t({ message: "Running" }),
							completed: t({ message: "Completed" }),
							failed: t({ message: "Failed" }),
							declined: t({ message: "Rejected" }),
							canceled: t({ message: "Cancelled" }),
						}[item.status]
					}
				</span>
			</summary>
			{item.content.map((part) => (
				<pre
					key={`${part.type}:${JSON.stringify(part)}`}
					className="mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]"
				>
					{part.type === "text"
						? part.text
						: part.type === "terminal"
							? `${part.command}\n${part.output}`
							: `${part.path}\n${part.newText}`}
				</pre>
			))}
		</details>
	);
}
