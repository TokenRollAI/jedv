import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mobileApiSource } from "./api";
import { mobileAttentionSource } from "./attention";
import { mobileCatalogSource } from "./catalog";
import { mobileAppSource } from "./controller";
import { mobileI18nSource } from "./i18n";
import { mobileIcons } from "./icons";
import { mobileMarkdownSource } from "./markdown";
import { mobileHtml } from "./shell";
import {
	mobileAttentionStyles,
	mobileConversationStyles,
	mobileStyles,
} from "./styles";
import { mobileUiSource } from "./ui";
import { mobileWorkerSource } from "./worker";
export interface MobilePublicAsset {
	path: string;
	content: string | Uint8Array;
	contentType: string;
	cacheControl: string;
}
const publicCache = "public, max-age=0, must-revalidate";
const entries: MobilePublicAsset[] = [];
function asset(
	path: string,
	content: string | Uint8Array,
	contentType: string,
	cacheControl = publicCache,
) {
	entries.push({ path, content, contentType, cacheControl });
}
asset("/mobile", mobileHtml, "text/html; charset=utf-8");
asset("/mobile/", mobileHtml, "text/html; charset=utf-8");
asset(
	"/mobile/attention.js",
	mobileAttentionSource,
	"text/javascript; charset=utf-8",
);
asset("/mobile/app.js", mobileAppSource, "text/javascript; charset=utf-8");
asset("/mobile/client.js", mobileApiSource, "text/javascript; charset=utf-8");
asset(
	"/mobile/markdown.js",
	mobileMarkdownSource,
	"text/javascript; charset=utf-8",
);
asset("/mobile/ui.js", mobileUiSource, "text/javascript; charset=utf-8");
asset("/mobile/i18n.js", mobileI18nSource, "text/javascript; charset=utf-8");
asset(
	"/mobile/messages.js",
	mobileCatalogSource(),
	"text/javascript; charset=utf-8",
);
asset(
	"/mobile/styles.css",
	mobileStyles + mobileConversationStyles + mobileAttentionStyles,
	"text/css; charset=utf-8",
);
asset(
	"/mobile/manifest.webmanifest",
	JSON.stringify({
		id: "/mobile/",
		name: "Jedv",
		short_name: "Jedv",
		start_url: "/mobile/",
		scope: "/mobile/",
		display: "standalone",
		background_color: "#0d0d18",
		theme_color: "#0d0d18",
		icons: [
			{
				src: "/mobile/icons/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/mobile/icons/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
		],
	}),
	"application/manifest+json",
);
for (const [name, value] of Object.entries(mobileIcons))
	asset(
		`/mobile/icons/${name}`,
		"base64" in value
			? Uint8Array.from(Buffer.from(value.base64, "base64"))
			: value.content,
		value.contentType,
	);
const version = createHash("sha256")
	.update(
		entries
			.map(
				(entry) =>
					entry.path +
					":" +
					(typeof entry.content === "string"
						? entry.content
						: Buffer.from(entry.content).toString("base64")),
			)
			.join("\n"),
	)
	.digest("hex")
	.slice(0, 16);
asset(
	"/mobile/service-worker.js",
	mobileWorkerSource(
		entries.map((entry) => entry.path),
		version,
	),
	"text/javascript; charset=utf-8",
	"no-cache",
);
export const mobilePublicAssets: ReadonlyArray<MobilePublicAsset> =
	Object.freeze(entries.map((entry) => Object.freeze(entry)));
