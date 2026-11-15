import { toast } from "@jedv/ui/sonner";
import { useLingui } from "@lingui/react/macro";
import { isSafeExternalUrl } from "main/lib/safe-url/scheme";
import { type ComponentProps, useContext } from "react";
import { ButlerMarkdownContext } from "../../markdown-context";
export function ButlerMarkdownLink({
	href,
	children,
	title,
}: ComponentProps<"a">) {
	const { t } = useLingui();
	const open = useContext(ButlerMarkdownContext);
	if (!href || !isSafeExternalUrl(href)) return <span>{children}</span>;
	return (
		<a
			href={href}
			title={title ?? href}
			className="rounded underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={(event) => {
				event.preventDefault();
				void open(href).catch(() =>
					toast.error(t({ message: "Operation failed" })),
				);
			}}
			onAuxClick={(event) => {
				event.preventDefault();
				if (event.button === 1)
					void open(href).catch(() =>
						toast.error(t({ message: "Operation failed" })),
					);
			}}
		>
			{children}
		</a>
	);
}
