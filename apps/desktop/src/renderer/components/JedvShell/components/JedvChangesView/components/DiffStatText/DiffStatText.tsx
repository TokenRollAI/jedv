interface DiffStatTextProps {
	additions: number | null;
	deletions: number | null;
}

export function DiffStatText({ additions, deletions }: DiffStatTextProps) {
	if (additions === null || deletions === null) return null;
	if (additions <= 0 && deletions <= 0) return null;
	return (
		<>
			{additions > 0 && <span className="text-green-400">+{additions}</span>}
			{additions > 0 && deletions > 0 && " "}
			{deletions > 0 && <span className="text-red-400">−{deletions}</span>}
		</>
	);
}
