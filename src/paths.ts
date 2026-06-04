import * as path from 'path';

export function getPathParts(fileSystemPath: string) {
	const pathApi = getPathApi(fileSystemPath);
	const basename = pathApi.basename(fileSystemPath);
	const extname = pathApi.extname(basename);

	return {
		basename,
		basenameNoExtension: extname ? basename.slice(0, -extname.length) : basename,
		dirname: pathApi.dirname(fileSystemPath),
		extname: extname.toLowerCase(),
	};
}

export function getRelativePath(from: string, to: string) {
	const pathApi = getPathApiForPaths(from, to);
	return pathApi.relative(from, to) || pathApi.basename(to);
}

export function getContainedRelativePath(from: string, to: string) {
	const pathApi = getPathApiForPaths(from, to);
	const relative = pathApi.relative(from, to);

	return relative && isContainedRelativePath(relative, pathApi)
		? relative
		: undefined;
}

export function isPathWithinOrEqual(parent: string, child: string) {
	const pathApi = getPathApiForPaths(parent, child);
	const relative = pathApi.relative(parent, child);
	return relative === '' || isContainedRelativePath(relative, pathApi);
}

export function isSamePath(left: string, right: string) {
	return getPathApiForPaths(left, right).relative(left, right) === '';
}

export function getPathApi(fileSystemPath: string) {
	return usesWindowsSeparators(fileSystemPath) ? path.win32 : path.posix;
}

function getPathApiForPaths(left: string, right: string) {
	return usesWindowsSeparators(left) || usesWindowsSeparators(right) ? path.win32 : path.posix;
}

function isContainedRelativePath(relativePath: string, pathApi: typeof path.posix | typeof path.win32) {
	return !pathApi.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${pathApi.sep}`);
}

function usesWindowsSeparators(fileSystemPath: string): boolean {
	return /^[a-z]:[\\/]/i.test(fileSystemPath) || fileSystemPath.includes('\\');
}
