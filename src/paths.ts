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
	const pathApi = usesWindowsSeparators(from) || usesWindowsSeparators(to) ? path.win32 : path.posix;
	return pathApi.relative(from, to) || pathApi.basename(to);
}

export function getContainedRelativePath(from: string, to: string) {
	const pathApi = usesWindowsSeparators(from) || usesWindowsSeparators(to) ? path.win32 : path.posix;
	const relative = pathApi.relative(from, to);

	return relative && !pathApi.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`)
		? relative
		: undefined;
}

export function getPathApi(fileSystemPath: string) {
	return usesWindowsSeparators(fileSystemPath) ? path.win32 : path.posix;
}

function usesWindowsSeparators(fileSystemPath: string): boolean {
	return /^[a-z]:[\\/]/i.test(fileSystemPath) || fileSystemPath.includes('\\');
}
