import { i18n } from "@jedv/i18n";
import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { toast } from "@jedv/ui/sonner";
import { cn } from "@jedv/ui/utils";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { createElement, useCallback, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconType } from "react-icons";
import {
	LuBug,
	LuCode,
	LuFlame,
	LuFolder,
	LuGlobe,
	LuHeart,
	LuLeaf,
	LuPackage,
	LuRocket,
	LuStar,
	LuTerminal,
	LuUpload,
	LuZap,
} from "react-icons/lu";
import { ColorSelector } from "renderer/components/ColorSelector";
import { PROJECT_COLOR_DEFAULT } from "shared/constants/project-colors";
import type { LocalClient } from "../../../local-client";
import { ProjectThumbnail } from "../ProjectThumbnail";
import { PROJECT_ICON_NONE } from "../project-icon";

const ACCEPTED_MIME_TYPES = "image/png,image/jpeg,image/webp";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const ICON_SIZE = 128;

const DEFAULT_GLYPH_COLOR = "#64748b";

const GLYPHS: Array<{
	name: string;
	label: MessageDescriptor;
	icon: IconType;
}> = [
	{
		name: "Folder",
		label: msg({ message: "Folder" }),
		icon: LuFolder,
	},
	{
		name: "Rocket",
		label: msg({ message: "Rocket" }),
		icon: LuRocket,
	},
	{
		name: "Star",
		label: msg({ message: "Star" }),
		icon: LuStar,
	},
	{
		name: "Heart",
		label: msg({ message: "Heart" }),
		icon: LuHeart,
	},
	{
		name: "Zap",
		label: msg({ message: "Zap" }),
		icon: LuZap,
	},
	{
		name: "Flame",
		label: msg({ message: "Flame" }),
		icon: LuFlame,
	},
	{
		name: "Leaf",
		label: msg({ message: "Leaf" }),
		icon: LuLeaf,
	},
	{
		name: "Globe",
		label: msg({ message: "Globe" }),
		icon: LuGlobe,
	},
	{
		name: "Code",
		label: msg({ message: "Code" }),
		icon: LuCode,
	},
	{
		name: "Terminal",
		label: msg({
			message: "Terminal",
		}),
		icon: LuTerminal,
	},
	{
		name: "Bug",
		label: msg({ message: "Bug" }),
		icon: LuBug,
	},
	{
		name: "Package",
		label: msg({
			message: "Package",
		}),
		icon: LuPackage,
	},
];

interface IconUploadFieldProps {
	projectId: string;
	projectName: string;
	client: LocalClient | null;
	onUpdated?(): Promise<void>;
	iconUrl: string | null;
	hasCustomIcon: boolean;
	isIconRemoved: boolean;
	color: string | null;
}

function hexToRgba(hex: string, alpha: number): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function svgToPngDataUri(svg: string): Promise<string> {
	const img = await new Promise<HTMLImageElement>((resolve, reject) => {
		const el = new Image();
		el.onload = () => resolve(el);
		el.onerror = () =>
			reject(new Error(i18n._(msg({ message: "Could not render icon" }))));
		el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	});
	const canvas = document.createElement("canvas");
	canvas.width = ICON_SIZE;
	canvas.height = ICON_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error(i18n._(msg({ message: "Could not render icon" })));
	ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE);
	return canvas.toDataURL("image/png");
}

function glyphToDataUri(
	glyph: IconType,
	color: string | null,
): Promise<string> {
	const stroke = color ?? DEFAULT_GLYPH_COLOR;
	const bg = hexToRgba(stroke, color ? 0.15 : 0.12);
	const glyphMarkup = renderToStaticMarkup(
		createElement(glyph, { size: 72, color: stroke }),
	);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">` +
		`<rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${bg}"/>` +
		`<g transform="translate(28,28)">${glyphMarkup}</g></svg>`;
	return svgToPngDataUri(svg);
}

async function toIconDataUri(file: File): Promise<string> {
	const url = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () =>
				reject(new Error(i18n._(msg({ message: "Could not read image" }))));
			el.src = url;
		});
		const canvas = document.createElement("canvas");
		canvas.width = ICON_SIZE;
		canvas.height = ICON_SIZE;
		const ctx = canvas.getContext("2d");
		if (!ctx)
			throw new Error(i18n._(msg({ message: "Could not render image" })));
		const scale = Math.max(ICON_SIZE / img.width, ICON_SIZE / img.height);
		const w = img.width * scale;
		const h = img.height * scale;
		ctx.drawImage(img, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2, w, h);
		return canvas.toDataURL("image/png");
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function IconUploadField({
	projectId,
	projectName,
	client,
	onUpdated,
	iconUrl,
	hasCustomIcon,
	isIconRemoved,
	color,
}: IconUploadFieldProps) {
	const { t } = useLingui();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);

	const [sessionGlyph, setSessionGlyph] = useState<IconType | null>(null);
	const [iconRetry, setIconRetry] = useState<{
		glyph: IconType;
		color: string | null;
	} | null>(null);
	const disabled = isPending || !client;

	const setIcon = useCallback(
		async (icon: string | null): Promise<boolean> => {
			if (!client) {
				toast.error(
					t({
						message: "This project's host is offline",
					}),
				);
				return false;
			}
			setIsPending(true);
			setFailure(null);
			try {
				await client.project.setIcon.mutate({
					projectId,
					icon,
				});
				await onUpdated?.();
				return true;
			} catch (err) {
				setFailure(errorMessage(err));
				toast.error(
					errorMessage(
						err,
						t({
							message: "Failed to set icon",
						}),
					),
				);
				return false;
			} finally {
				setIsPending(false);
			}
		},
		[client, projectId, t, onUpdated],
	);

	const setColor = useCallback(
		async (nextColor: string | null): Promise<boolean> => {
			if (!client) {
				toast.error(
					t({
						message: "This project's host is offline",
					}),
				);
				return false;
			}
			setIsPending(true);
			setFailure(null);
			try {
				await client.project.setColor.mutate({
					projectId,
					color: nextColor,
				});
				await onUpdated?.();
				return true;
			} catch (err) {
				setFailure(errorMessage(err));
				toast.error(
					errorMessage(
						err,
						t({
							message: "Failed to set color",
						}),
					),
				);
				return false;
			} finally {
				setIsPending(false);
			}
		},
		[client, projectId, t, onUpdated],
	);

	const handleSelectGlyph = useCallback(
		async (glyph: IconType) => {
			let dataUri: string;
			try {
				dataUri = await glyphToDataUri(glyph, color);
			} catch (err) {
				setFailure(errorMessage(err));
				toast.error(
					errorMessage(
						err,
						t({
							message: "Could not set icon",
						}),
					),
				);
				return;
			}

			if (await setIcon(dataUri)) setSessionGlyph(() => glyph);
		},
		[color, setIcon, t],
	);

	const handleSelectColor = useCallback(
		async (value: string) => {
			const nextColor = value === PROJECT_COLOR_DEFAULT ? null : value;

			if (!(await setColor(nextColor))) return;

			if (sessionGlyph) {
				try {
					const saved = await setIcon(
						await glyphToDataUri(sessionGlyph, nextColor),
					);
					if (!saved) throw new Error("icon-update-failed");
					setIconRetry(null);
				} catch {
					setIconRetry({ glyph: sessionGlyph, color: nextColor });
					setFailure(
						t({
							message:
								"Color saved, but the icon could not be updated. Retry the icon update.",
						}),
					);
				}
			}
		},
		[sessionGlyph, setColor, setIcon, t],
	);

	const handleClickUpload = useCallback(() => {
		if (!fileInputRef.current) return;
		fileInputRef.current.value = "";
		fileInputRef.current.click();
	}, []);

	const handleFileChange = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			e.target.value = "";
			if (!file) return;
			if (file.size > MAX_SOURCE_BYTES) {
				toast.error(
					t({
						message: "Image is too large (max 10MB)",
					}),
				);
				return;
			}
			let dataUri: string;
			try {
				dataUri = await toIconDataUri(file);
			} catch (err) {
				setFailure(errorMessage(err));
				toast.error(
					errorMessage(
						err,
						t({
							message: "Could not read selected file",
						}),
					),
				);
				return;
			}
			setSessionGlyph(null);
			await setIcon(dataUri);
		},
		[setIcon, t],
	);

	return (
		<>
			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={disabled}
						aria-label={t({
							message: "Change project icon and color",
						})}
						className="rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
					>
						<ProjectThumbnail
							projectName={projectName}
							iconUrl={iconUrl}
							color={color}
							className="size-9 rounded-md text-sm"
						/>
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-66 space-y-3">
					{iconRetry && (
						<Button
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={async () => {
								try {
									if (
										await setIcon(
											await glyphToDataUri(iconRetry.glyph, iconRetry.color),
										)
									)
										setIconRetry(null);
								} catch {
									setFailure(
										t({
											message:
												"Color saved, but the icon could not be updated. Retry the icon update.",
										}),
									);
								}
							}}
						>
							<Trans>Retry icon update</Trans>
						</Button>
					)}
					{failure && (
						<p role="alert" className="break-words text-xs text-destructive">
							{failure}
						</p>
					)}
					<div>
						<p className="mb-1.5 text-xs font-medium text-muted-foreground">
							<Trans>Color</Trans>
						</p>
						<ColorSelector
							includeDefault
							selectedColor={color}
							disabled={disabled}
							onSelectColor={(value) => {
								void handleSelectColor(value);
							}}
						/>
					</div>
					<div>
						<p className="mb-1.5 text-xs font-medium text-muted-foreground">
							<Trans>Icon</Trans>
						</p>
						<div className="grid grid-cols-6 gap-1">
							{GLYPHS.map((glyph) => (
								<button
									key={glyph.name}
									type="button"
									title={i18n._(glyph.label)}
									aria-label={t({
										message: `Set icon to ${i18n._(glyph.label)}`,
									})}
									disabled={disabled}
									onClick={() => {
										void handleSelectGlyph(glyph.icon);
									}}
									className={cn(
										"flex size-8 items-center justify-center rounded-md border border-transparent",
										"hover:bg-accent hover:text-accent-foreground",
										"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										"disabled:cursor-not-allowed disabled:opacity-50",
									)}
									style={{ color: color ?? undefined }}
								>
									<glyph.icon className="size-4" />
								</button>
							))}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 border-t pt-3">
						<Button
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={handleClickUpload}
						>
							<LuUpload className="size-3.5" />
							<Trans>Upload image…</Trans>
						</Button>
						{iconUrl && (
							<Button
								variant="ghost"
								size="sm"
								disabled={disabled}
								onClick={() => {
									setSessionGlyph(null);
									void setIcon(PROJECT_ICON_NONE);
								}}
							>
								<Trans>Remove icon</Trans>
							</Button>
						)}
						{(hasCustomIcon || isIconRemoved) && (
							<Button
								variant="ghost"
								size="sm"
								disabled={disabled}
								onClick={() => {
									setSessionGlyph(null);
									void setIcon(null);
								}}
							>
								<Trans>Reset to default</Trans>
							</Button>
						)}
					</div>
				</PopoverContent>
			</Popover>
			<input
				ref={fileInputRef}
				type="file"
				accept={ACCEPTED_MIME_TYPES}
				className="hidden"
				onChange={handleFileChange}
			/>
		</>
	);
}
