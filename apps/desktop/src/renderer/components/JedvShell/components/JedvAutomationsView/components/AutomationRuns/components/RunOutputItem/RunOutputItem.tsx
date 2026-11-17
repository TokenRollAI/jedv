import { type Decision, type Item, isKnownItem } from "@jedv/chat/protocol";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { JedvMultiSelect } from "../../../../../JedvMultiSelect";
import { JedvSelect } from "../../../../../JedvSelect";
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
	const optionLabel = (label: string) => {
		switch (label.trim().toLowerCase()) {
			case "allow":
				return t({ message: "Allow" });
			case "deny":
				return t({ message: "Deny" });
			case "allow once":
				return t({ message: "Allow once" });
			case "reject":
				return t({ message: "Reject" });
			default:
				return label;
		}
	};
	const requiredMissing =
		isKnownItem(item) &&
		item.kind === "approval_request" &&
		item.form?.fields.some(
			(field) =>
				field.required &&
				(values[field.id] == null ||
					values[field.id] === "" ||
					(Array.isArray(values[field.id]) && values[field.id]?.length === 0)),
		);
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
			<div className="rounded-xl border border-warning/35 bg-warning/[0.06] p-3.5 text-xs">
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
									if (!pending && canControl && !requiredMissing)
										onApprove({ type: "form", values });
								}}
							>
								<p>{item.form.message}</p>
								{item.form.fields.map((field) => (
									<div key={field.id} className="mt-2 block">
										<label htmlFor={`approval-${item.id}-${field.id}`}>
											{field.title ?? field.id}
										</label>
										{field.description && (
											<span className="block text-muted-foreground">
												{field.description}
											</span>
										)}
										{field.options ? (
											field.input === "multi" ? (
												<JedvMultiSelect
													id={`approval-${item.id}-${field.id}`}
													label={field.title ?? field.id}
													disabled={pending || !canControl}
													value={
														Array.isArray(values[field.id])
															? (values[field.id] as string[])
															: []
													}
													options={field.options}
													onValueChange={(value) =>
														setValues((v) => ({ ...v, [field.id]: value }))
													}
												/>
											) : (
												<JedvSelect
													id={`approval-${item.id}-${field.id}`}
													label={field.title ?? field.id}
													disabled={pending || !canControl}
													required={field.required}
													value={
														typeof values[field.id] === "string"
															? (values[field.id] as string)
															: ""
													}
													options={[
														{
															value: "",
															label: t({ message: "Select an option" }),
														},
														...field.options,
													]}
													onValueChange={(value) =>
														setValues((v) => ({ ...v, [field.id]: value }))
													}
													className="mt-1 w-full"
												/>
											)
										) : field.input === "boolean" ? (
											<JedvSelect
												id={`approval-${item.id}-${field.id}`}
												label={field.title ?? field.id}
												disabled={pending || !canControl}
												required={field.required}
												value={
													typeof values[field.id] === "string"
														? (values[field.id] as string)
														: ""
												}
												onValueChange={(value) =>
													setValues((v) => ({ ...v, [field.id]: value }))
												}
												options={[
													{
														value: "",
														label: t({ message: "Select an option" }),
													},
													{ value: "true", label: t({ message: "Yes" }) },
													{ value: "false", label: t({ message: "No" }) },
												]}
												className="mt-1 w-full"
											/>
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
									</div>
								))}
								<Button
									type="submit"
									size="sm"
									className="mt-3 h-7"
									disabled={pending || !canControl || !!requiredMissing}
								>
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
											{optionLabel(option.label)}
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
		<details className="rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 text-xs">
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
