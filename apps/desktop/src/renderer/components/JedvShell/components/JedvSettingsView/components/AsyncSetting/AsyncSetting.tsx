import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Switch } from "@jedv/ui/switch";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { SettingRow } from "../SettingRow";

interface Props<T extends string | boolean | number> {
	id: string;
	label: string;
	description?: string;
	read(): Promise<T>;
	write(value: T): Promise<unknown>;
	options?: ReadonlyArray<{ value: T; label: string }>;
	min?: number;
	max?: number;
	step?: number;
}
export function AsyncSetting<T extends string | boolean | number>({
	id,
	label,
	description,
	read,
	write,
	options,
	min,
	max,
	step,
}: Props<T>) {
	const { t } = useLingui();
	const inputId = useId();
	const cache = useQueryClient();
	const queryKey = ["jedv-settings", id];
	const value = useQuery({ queryKey, queryFn: read });
	const [draft, setDraft] = useState("");
	const [validation, setValidation] = useState<string | null>(null);
	useEffect(() => {
		if (value.data !== undefined) setDraft(String(value.data));
	}, [value.data]);
	const mutation = useMutation({
		mutationFn: write,
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey });
		},
	});
	const failure = mutation.error ?? value.error;
	const commit = () => {
		if (value.data === undefined || draft === String(value.data)) return;
		setValidation(null);
		const next = typeof value.data === "number" ? Number(draft) : draft;
		if (
			typeof next === "number" &&
			(!Number.isFinite(next) ||
				(min !== undefined && next < min) ||
				(max !== undefined && next > max) ||
				(step !== undefined &&
					Math.abs(next / step - Math.round(next / step)) > 1e-9) ||
				draft.trim() === "")
		) {
			setValidation(
				t({ message: "Enter a valid value within the allowed range." }),
			);
			return;
		}
		mutation.mutate(next as T);
	};
	return (
		<SettingRow
			label={label}
			description={description}
			error={
				validation ??
				(failure
					? errorMessage(
							failure,
							t({ message: "Could not save this setting. Try again." }),
						)
					: undefined)
			}
		>
			<div
				className="flex items-center gap-2"
				aria-busy={value.isPending || mutation.isPending}
			>
				{value.isPending ? (
					<span className="text-xs text-muted-foreground">
						<Trans>Loading…</Trans>
					</span>
				) : value.data === undefined ? (
					<Button
						size="sm"
						variant="outline"
						onClick={() => void value.refetch()}
					>
						<Trans>Retry</Trans>
					</Button>
				) : typeof value.data === "boolean" ? (
					<Switch
						aria-label={label}
						checked={value.data}
						disabled={mutation.isPending}
						onCheckedChange={(next) => mutation.mutate(next as T)}
					/>
				) : options ? (
					<Select
						value={String(value.data)}
						disabled={mutation.isPending}
						onValueChange={(next) => mutation.mutate(next as T)}
					>
						<SelectTrigger
							size="sm"
							className="min-w-44 w-auto"
							aria-label={label}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem
									key={String(option.value)}
									value={String(option.value)}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<Input
						id={inputId}
						aria-label={label}
						className={
							typeof value.data === "number"
								? "h-8 w-24"
								: "h-8 w-64 max-w-full"
						}
						type={typeof value.data === "number" ? "number" : "text"}
						min={min}
						max={max}
						step={step}
						value={draft}
						disabled={mutation.isPending}
						onChange={(event) => {
							setDraft(event.target.value);
							setValidation(null);
						}}
						onBlur={commit}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
					/>
				)}
				{mutation.isPending && (
					<output className="text-xs text-muted-foreground">
						<Trans>Saving…</Trans>
					</output>
				)}
				{mutation.isError && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							if (mutation.variables !== undefined)
								mutation.mutate(mutation.variables);
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				)}
			</div>
		</SettingRow>
	);
}
