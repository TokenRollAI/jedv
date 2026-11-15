export class ForwardTokens {
	private readonly hostTokens = new Map<string, string>();
	setHostToken(hostUrl: string, token: string | null): void {
		if (token) this.hostTokens.set(hostUrl, token);
		else this.hostTokens.delete(hostUrl);
	}
	hostTokenFor(hostUrl: string): string | null {
		return this.hostTokens.get(hostUrl) ?? null;
	}
	clearCredentials(): void {
		this.hostTokens.clear();
	}
}
