import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mobileMarkdownSource } from "./markdown";
const { Window } = createRequire(
	realpathSync(
		new URL(
			"../../../../i18n/node_modules/@happy-dom/global-registrator/package.json",
			import.meta.url,
		),
	),
)("happy-dom");
test("Markdown uses readable DOM structure and treats arbitrary HTML/unsafe URLs as inert text", async () => {
	const dir = mkdtempSync(join(tmpdir(), "jedv-mobile-markdown-"));
	const window = new Window();
	try {
		const path = join(dir, "markdown.mjs");
		writeFileSync(path, mobileMarkdownSource);
		const { renderMarkdown } = await import(path);
		const text = [
			"# Heading",
			"",
			"**Strong** and *emphasis* with `inline`",
			"",
			"- First",
			"- Second",
			"",
			"1. One",
			"2. Two",
			"",
			"> Quoted",
			"",
			"```js",
			"<script>alert(1)</script>",
			"```",
			"",
			"[Safe](https://example.test/path) [Bad](javascript:alert(1)) ![Remote](https://example.test/a.png)",
			'<img src=x onerror=alert(1)> <iframe src="https://evil.test"></iframe>',
		].join("\n");
		const node = renderMarkdown(window.document, text);
		window.document.body.append(node);
		expect(node.querySelector("h1")?.textContent).toBe("Heading");
		expect(node.querySelector("strong")?.textContent).toBe("Strong");
		expect(node.querySelector("em")?.textContent).toBe("emphasis");
		expect(node.querySelectorAll("li")).toHaveLength(4);
		expect(node.querySelector("blockquote")?.textContent).toBe("Quoted");
		expect(node.querySelector("pre code")?.textContent).toBe(
			"<script>alert(1)</script>",
		);
		expect(node.querySelectorAll("a")).toHaveLength(1);
		expect(node.querySelector("a")?.href).toBe("https://example.test/path");
		expect(node.querySelector("a")?.rel).toBe("noopener noreferrer");
		expect(node.querySelector("script,img,iframe,svg,style")).toBeNull();
		expect(node.textContent).toContain("<img src=x onerror=alert(1)>");
		for (const url of [
			"data:text/html,bad",
			"file:///tmp/a",
			"//evil.test",
			"javascript:alert",
			"https://ok.test",
		]) {
			const result = renderMarkdown(window.document, `[link](${url})`);
			expect(!!result.querySelector("a")).toBe(url.startsWith("https://"));
		}
	} finally {
		await window.happyDOM.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
