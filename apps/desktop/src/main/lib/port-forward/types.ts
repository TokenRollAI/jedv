import type { Duplex } from "node:stream";
import type { ForwardTarget, ForwardTransportKind } from "shared/types";

export interface ForwardRequestOptions {
	signal?: AbortSignal;
}

export interface ForwardTransport {
	readonly kind: ForwardTransportKind;
	probe(target: ForwardTarget, options?: ForwardRequestOptions): Promise<void>;
	/** One bidirectional byte stream to 127.0.0.1:<remotePort> on the host. */
	openStream(
		target: ForwardTarget,
		options?: ForwardRequestOptions,
	): Promise<Duplex>;
}
