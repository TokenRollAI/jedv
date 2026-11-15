export function isLoopbackBrowserUrl(url: string): boolean {
	try {
		const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
		return (
			hostname === "localhost" ||
			hostname.endsWith(".localhost") ||
			/^127\./.test(hostname) ||
			hostname === "0.0.0.0" ||
			hostname === "[::1]" ||
			hostname === "[::]"
		);
	} catch {
		return false;
	}
}
