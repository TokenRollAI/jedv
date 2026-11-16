export class ForwardTokens {
	private readonly hostTokens = new Map<
		string,
		{ token: string; source: "coordinator" | "authenticated-private" }
	>();
	private readonly privateAttempts = new Map<string, symbol>();

	setHostToken(hostUrl: string, token: string | null): void {
		this.privateAttempts.delete(hostUrl);
		if (token) this.hostTokens.set(hostUrl, { token, source: "coordinator" });
		else this.hostTokens.delete(hostUrl);
	}
	beginPrivateConnection(hostUrl: string) {
		const attempt = Symbol();
		this.privateAttempts.set(hostUrl, attempt);
		this.hostTokens.delete(hostUrl);
		return {
			commit: (token: string): boolean => {
				if (this.privateAttempts.get(hostUrl) !== attempt) return false;
				this.privateAttempts.delete(hostUrl);
				this.hostTokens.set(hostUrl, {
					token,
					source: "authenticated-private",
				});
				return true;
			},
			cancel: () => {
				if (this.privateAttempts.get(hostUrl) === attempt)
					this.privateAttempts.delete(hostUrl);
			},
		};
	}

	hostTokenFor(hostUrl: string): string | null {
		return this.hostTokens.get(hostUrl)?.token ?? null;
	}

	hasHostConnection(
		hostUrl: string,
		coordinatorConnections: readonly { port: number; secret: string }[],
	): boolean {
		const connection = this.hostTokens.get(hostUrl);
		if (!connection) return false;
		if (connection.source === "authenticated-private") return true;
		return coordinatorConnections.some(
			(local) =>
				hostUrl === `http://127.0.0.1:${local.port}` &&
				connection.token === local.secret,
		);
	}

	clearCredentials(): void {
		this.hostTokens.clear();
		this.privateAttempts.clear();
	}
}
