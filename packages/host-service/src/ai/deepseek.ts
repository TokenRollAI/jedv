export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-flash";
export interface DeepseekToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}
export interface DeepseekMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
export interface DeepseekChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: DeepseekToolCall[];
	tool_call_id?: string;
}
export interface DeepseekTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}
export type DeepseekFailure = "no_key" | "budget" | "unavailable";
export type DeepseekResult =
	| { content: string; reason: null }
	| { content: null; reason: DeepseekFailure };
export interface DeepseekDependencies {
	readKey: () => string | null;
	fetch?: (
		url: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>;
	timeoutMs?: number;
	scheduleTimeout?: (fn: () => void, ms: number) => () => void;
}
export type DeepseekToolResult = {
	content: string | null;
	toolCalls: DeepseekToolCall[];
	reason: DeepseekFailure | null;
};
export class DeepseekClient {
	private disposed = false;
	private readonly pending = new Set<() => void>();
	constructor(private readonly deps: DeepseekDependencies) {}
	dispose() {
		this.disposed = true;
		for (const cancel of this.pending) cancel();
		this.pending.clear();
	}
	async complete(
		messages: DeepseekMessage[],
		options: { json?: boolean } = {},
	): Promise<DeepseekResult> {
		const result = await this.request(messages, options);
		return result.reason || !result.content
			? { content: null, reason: result.reason ?? "unavailable" }
			: { content: result.content, reason: null };
	}
	callTools(
		messages: DeepseekChatMessage[],
		tools: DeepseekTool[],
	): Promise<DeepseekToolResult> {
		return this.request(messages, { tools });
	}
	private async request(
		messages: DeepseekChatMessage[],
		options: { json?: boolean; tools?: DeepseekTool[] },
	): Promise<DeepseekToolResult> {
		const fail = (reason: DeepseekFailure): DeepseekToolResult => ({
			content: null,
			toolCalls: [],
			reason,
		});
		if (this.disposed) return fail("unavailable");
		const key = this.deps.readKey();
		if (!key) return fail("no_key");
		if (
			!messages.length ||
			messages.length > 40 ||
			JSON.stringify(messages).length > 40000 ||
			(options.tools?.length ?? 0) > 24
		)
			return fail("budget");
		// Preserve the smaller active-memory request budget.
		if (
			!options.tools &&
			messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) > 32000
		)
			return fail("budget");
		const abort = new AbortController();
		let cancel = () => {},
			cancelRequest = () => {};
		const schedule =
			this.deps.scheduleTimeout ??
			((fn, ms) => {
				const t = setTimeout(fn, ms);
				t.unref?.();
				return () => clearTimeout(t);
			});
		try {
			const timedOut = new Promise<never>((_, reject) => {
				cancelRequest = () => {
					abort.abort();
					reject(new Error("DeepSeek unavailable"));
				};
				this.pending.add(cancelRequest);
				cancel = schedule(cancelRequest, this.deps.timeoutMs ?? 12000);
			});
			const request = async () => {
				const response = await (this.deps.fetch ?? fetch)(DEEPSEEK_ENDPOINT, {
					method: "POST",
					redirect: "error",
					signal: abort.signal,
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${key}`,
					},
					body: JSON.stringify({
						model: DEEPSEEK_MODEL,
						messages,
						stream: false,
						thinking: { type: "disabled" },
						max_tokens: 1500,
						...(options.json
							? { response_format: { type: "json_object" } }
							: {}),
						...(options.tools
							? { tools: options.tools, tool_choice: "auto" }
							: {}),
					}),
				});
				if (!response.ok) throw new Error("DeepSeek unavailable");
				const body = await response.text();
				if (body.length > 100000 || body.includes(key))
					throw new Error("Invalid DeepSeek response");
				const choice = JSON.parse(body)?.choices?.[0];
				const content = choice?.message?.content;
				if (choice?.finish_reason === "tool_calls" && options.tools) {
					const raw = choice.message.tool_calls;
					if (!Array.isArray(raw) || !raw.length || raw.length > 8)
						throw new Error("Invalid tool calls");
					const ids = new Set<string>();
					for (const call of raw) {
						if (
							typeof call.id !== "string" ||
							!call.id ||
							call.id.length > 128 ||
							ids.has(call.id) ||
							call.type !== "function" ||
							typeof call.function?.name !== "string" ||
							typeof call.function?.arguments !== "string" ||
							call.function.arguments.length > 16000
						)
							throw new Error("Invalid tool call");
						ids.add(call.id);
					}
					return {
						content:
							typeof content === "string" ? content.slice(0, 16000) : null,
						toolCalls: raw as DeepseekToolCall[],
						reason: null,
					};
				}
				if (
					choice?.finish_reason !== "stop" ||
					typeof content !== "string" ||
					!content.trim() ||
					content.length > 16000
				)
					throw new Error("Incomplete DeepSeek response");
				return { content, toolCalls: [], reason: null };
			};
			return await Promise.race([request(), timedOut]);
		} catch {
			return fail("unavailable");
		} finally {
			this.pending.delete(cancelRequest);
			cancel();
			abort.abort();
		}
	}
}
