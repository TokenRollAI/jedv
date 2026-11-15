import { execFileSync } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const resources = join(appDir, "src/resources");
const sourcePath = join(resources, "brand/jedv-mark.svg");
const source = await readFile(sourcePath);
const iconsDir = join(resources, "build/icons");
await mkdir(iconsDir, { recursive: true });
await copyFile(sourcePath, join(appDir, "src/renderer/assets/jedv-logo.svg"));

const renderPng = (size: number, svg: Buffer = source) =>
	execFileSync(
		"rsvg-convert",
		["--width", String(size), "--height", String(size)],
		{ input: svg },
	);
const png = renderPng(1024);
await writeFile(join(resources, "brand/jedv-mark.png"), png);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => renderPng(size));
const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
for (const [index, data] of images.entries()) {
	const entry = 6 + index * 16;
	directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
	directory[entry + 1] = directory[entry];
	directory.writeUInt16LE(1, entry + 4);
	directory.writeUInt16LE(32, entry + 6);
	directory.writeUInt32LE(data.length, entry + 8);
	directory.writeUInt32LE(offset, entry + 12);
	offset += data.length;
}
const ico = Buffer.concat([directory, ...images]);
for (const name of ["icon", "icon-dev", "icon-canary"]) {
	await writeFile(join(iconsDir, `${name}.png`), png);
	await writeFile(join(iconsDir, `${name}.ico`), ico);
}

const tray = source
	.toString()
	.replace(/\s*<rect[^>]+\/>/, "")
	.replace('fill="#FAFAFA"', 'fill="#000000"');
await writeFile(
	join(resources, "tray/iconTemplate.png"),
	renderPng(16, Buffer.from(tray)),
);

if (process.platform === "darwin") {
	const temporary = await mkdtemp(join(tmpdir(), "jedv-icons-"));
	try {
		const iconset = join(temporary, "Jedv.iconset");
		await mkdir(iconset);
		for (const size of [16, 32, 128, 256, 512]) {
			for (const scale of [1, 2]) {
				await writeFile(
					join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
					renderPng(size * scale),
				);
			}
		}
		execFileSync("iconutil", [
			"-c",
			"icns",
			iconset,
			"-o",
			join(iconsDir, "icon.icns"),
		]);
		for (const name of ["icon-dev", "icon-canary"]) {
			await copyFile(
				join(iconsDir, "icon.icns"),
				join(iconsDir, `${name}.icns`),
			);
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
console.log("Generated Jedv renderer, application and tray icons.");
