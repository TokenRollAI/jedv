import semver from "semver";
export function shouldShowReleaseCard(
	current: string | null,
	previous: string | null,
	dismissed: string | null,
): boolean {
	if (
		!current ||
		!previous ||
		!semver.valid(current) ||
		!semver.valid(previous) ||
		!semver.gt(current, previous)
	)
		return false;
	return (
		!dismissed || !semver.valid(dismissed) || semver.gt(current, dismissed)
	);
}
