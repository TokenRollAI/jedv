export interface TreeBookkeeping {
	knownPaths: Set<string>;
	loadedDirs: Set<string>;
	unloadedDirCandidates: Set<string>;
}

export function purgeDirectory(
	bookkeeping: TreeBookkeeping,
	dirRel: string,
): void {
	const { knownPaths, loadedDirs, unloadedDirCandidates } = bookkeeping;
	const prefix = `${dirRel}/`;

	for (const path of knownPaths) {
		if (path.startsWith(prefix)) knownPaths.delete(path);
	}
	for (const dir of loadedDirs) {
		if (dir === dirRel || dir.startsWith(prefix)) loadedDirs.delete(dir);
	}
	for (const dir of unloadedDirCandidates) {
		if (dir === dirRel || dir.startsWith(prefix)) {
			unloadedDirCandidates.delete(dir);
		}
	}
}

export function rekeyDirectory(
	bookkeeping: TreeBookkeeping,
	oldDir: string,
	newDir: string,
): void {
	const { knownPaths, loadedDirs, unloadedDirCandidates } = bookkeeping;
	const oldPrefix = `${oldDir}/`;
	const movedKnown = [...knownPaths].filter((path) =>
		path.startsWith(oldPrefix),
	);
	for (const path of movedKnown) {
		knownPaths.delete(path);
		knownPaths.add(newDir + path.slice(oldDir.length));
	}

	const movedLoaded = [...loadedDirs].filter(
		(dir) => dir === oldDir || dir.startsWith(oldPrefix),
	);
	for (const dir of movedLoaded) {
		loadedDirs.delete(dir);
		loadedDirs.add(newDir + dir.slice(oldDir.length));
	}

	const movedCandidates = [...unloadedDirCandidates].filter(
		(dir) => dir === oldDir || dir.startsWith(oldPrefix),
	);
	for (const dir of movedCandidates) {
		unloadedDirCandidates.delete(dir);
		unloadedDirCandidates.add(newDir + dir.slice(oldDir.length));
	}
}
