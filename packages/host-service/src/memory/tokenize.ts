const cjk =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export function memoryTokens(text: string): string[] {
	const result = new Set<string>();
	for (const word of text
		.normalize("NFKC")
		.toLowerCase()
		.match(/[\p{L}\p{N}]+/gu) ?? []) {
		let latin = "";
		let previous = "";
		for (const char of word) {
			if (cjk.test(char)) {
				if (latin) result.add(latin);
				latin = "";
				result.add(char);
				if (previous) result.add(previous + char);
				previous = char;
			} else {
				previous = "";
				latin += char;
			}
		}
		if (latin) result.add(latin);
	}
	return [...result];
}
export function memoryMatch(query: string) {
	return memoryTokens(query)
		.map((x) => `"${x}"`)
		.join(" AND ");
}
