export function normalizePrivateEndpoint(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Enter a valid private host URL");
	}
	const loopback = url.hostname === "127.0.0.1";
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		!["http:", "https:"].includes(url.protocol)
	) {
		throw new Error(
			"Private host URL must be an origin without credentials, path or query",
		);
	}
	if (
		!loopback &&
		(url.protocol !== "https:" || !url.hostname.endsWith(".ts.net"))
	) {
		throw new Error(
			"Use an HTTPS Tailscale .ts.net endpoint; HTTP is allowed only on 127.0.0.1",
		);
	}
	return url.origin;
}

export function validatePrivateHostToken(token: string): string {
	if (!/^[\x21-\x7e]{1,4096}$/.test(token))
		throw new Error("A host PSK without whitespace is required");
	return token;
}
