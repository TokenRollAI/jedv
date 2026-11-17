import { cn } from "@jedv/ui/utils";

interface WorkspaceMarkProps {
	className?: string;
}

export function WorkspaceMark({ className }: WorkspaceMarkProps) {
	return (
		<svg
			viewBox="32 32 192 192"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={cn("text-[#eae8e6]", className)}
			aria-label="Jedv"
		>
			{/* The product name never translates (packages/i18n/glossary.md), so
			    it stays a literal rather than a catalog message. */}
			<title>{"Jedv"}</title>
			<g fill="currentColor">
				<circle cx="112" cy="48" r="12" />
				<circle cx="144" cy="48" r="12" />
				<circle cx="176" cy="48" r="12" />
				<circle cx="208" cy="48" r="12" />
				<circle cx="176" cy="80" r="12" />
				<circle cx="176" cy="112" r="12" />
				<circle cx="176" cy="144" r="12" />
				<circle cx="176" cy="176" r="12" />
				<circle cx="48" cy="176" r="12" />
				<circle cx="80" cy="176" r="12" />
				<circle cx="80" cy="208" r="12" />
				<circle cx="112" cy="208" r="12" />
				<circle cx="144" cy="208" r="12" />
				<circle cx="176" cy="208" r="12" />
			</g>
		</svg>
	);
}
