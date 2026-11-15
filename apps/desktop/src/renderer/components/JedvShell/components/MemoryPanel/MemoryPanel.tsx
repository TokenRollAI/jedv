import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { JedvSelect } from "../JedvSelect";
import { MemoryScopeView } from "./components/MemoryScopeView";
import { type MemoryPanelProps, scopeKey } from "./types";
export function MemoryPanel({ scopes, ...props }: MemoryPanelProps) {
	const { t } = useLingui();
	const [selected, setSelected] = useState(() =>
		scopes[0] ? scopeKey(scopes[0]) : "",
	);
	const scope = scopes.find((scope) => scopeKey(scope) === selected);
	const selector = (
		<JedvSelect
			label={t({ message: "Memory scope" })}
			value={selected}
			onValueChange={setSelected}
			options={scopes.map((option) => ({
				value: scopeKey(option),
				label: option.label,
			}))}
			className="max-w-48"
		/>
	);
	if (!scope) return <div className="py-2">{selector}</div>;
	return (
		<MemoryScopeView
			key={`${props.hostUrl}:${scopeKey(scope)}`}
			{...props}
			scope={scope}
			scopeSelector={selector}
		/>
	);
}
