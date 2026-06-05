export type PathStyle = 'auto' | 'native' | 'wsl';
export type ShellKind = 'cmd' | 'posix' | 'powershell';

export interface ShellEnvironment {
	currentWorkingDirectory?: string;
	defaultProfile?: string;
	pathStyle: PathStyle;
	platform: NodeJS.Platform;
	profileShellPath?: string;
	profileSource?: string;
	remoteName?: string;
	shellArgs?: readonly string[] | string;
	shellPath?: string;
	terminalName?: string;
	terminalStateShell?: string;
}

export interface ShellContext {
	hostPlatform: NodeJS.Platform;
	isWsl: boolean;
	kind: ShellKind;
	pathStyle: Exclude<PathStyle, 'auto'>;
	wslDistro?: string;
}

export function getShellContext(environment: ShellEnvironment): ShellContext {
	const identities = [
		environment.terminalStateShell,
		environment.shellPath,
		formatShellArgs(environment.shellArgs),
		environment.terminalName,
		environment.profileShellPath,
		environment.profileSource,
		environment.defaultProfile,
	].map(normalizeIdentity);
	const detectedShell = findDetectedShell(identities);
	const wslIdentityIndex = identities.findIndex(looksLikeWsl);

	const isRemoteWsl = environment.remoteName?.toLowerCase() === 'wsl';
	const isLocalWindows = environment.platform === 'win32' && !isRemoteWsl;
	const isWsl = environment.pathStyle === 'wsl'
		|| (environment.pathStyle === 'auto' && isLocalWindows && (
			looksLikeWslPath(environment.currentWorkingDirectory)
			|| isWslShell(wslIdentityIndex, detectedShell)
		));

	const kind = detectShellKind(detectedShell, environment.platform, isWsl);

	return {
		hostPlatform: environment.platform,
		isWsl,
		kind,
		pathStyle: isWsl ? 'wsl' : 'native',
		wslDistro: isWsl && isLocalWindows ? getWslDistro(environment) : undefined,
	};
}

export function toTerminalPath(fileSystemPath: string, context: ShellContext) {
	const path = stripExtendedWindowsPrefix(fileSystemPath);

	if (context.pathStyle === 'wsl') {
		return windowsPathToWsl(path);
	}

	if (context.kind === 'posix' && isWindowsPath(path)) {
		return path.replaceAll('\\', '/');
	}

	return path;
}

export function shellQuote(value: string, kind: ShellKind) {
	if (kind === 'cmd') {
		return `"${value.replaceAll('"', '""').replaceAll('%', '^%')}"`;
	}

	if (kind === 'powershell') {
		return `'${value.replaceAll("'", "''")}'`;
	}

	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function cdCommand(directory: string, context: ShellContext) {
	const quotedDirectory = shellQuote(toTerminalPath(directory, context), context.kind);

	if (context.kind === 'cmd') {
		return `cd /d ${quotedDirectory}`;
	}

	if (context.kind === 'powershell') {
		return `Set-Location -LiteralPath ${quotedDirectory}`;
	}

	return `cd -- ${quotedDirectory}`;
}

export function executablePathCommand(fileSystemPath: string, context: ShellContext) {
	const quotedPath = shellQuote(toTerminalPath(fileSystemPath, context), context.kind);
	return context.kind === 'powershell' ? `& ${quotedPath}` : quotedPath;
}

export function expandCommandTemplate(template: string, variables: Record<string, string>) {
	return template.replace(/\$\{([a-zA-Z][\w]*)\}/g, (token, name: string) => variables[name] ?? token);
}

interface DetectedShell {
	kind: ShellKind;
	sourceIndex: number;
}

function detectShellKind(detectedShell: DetectedShell | undefined, platform: NodeJS.Platform, isWsl: boolean): ShellKind {
	if (isWsl) {
		return 'posix';
	}

	return detectedShell?.kind ?? (platform === 'win32' ? 'powershell' : 'posix');
}

function findDetectedShell(identities: string[]): DetectedShell | undefined {
	for (const [sourceIndex, identity] of identities.entries()) {
		const kind = detectShellKindFromIdentity(identity);
		if (kind) {
			return { kind, sourceIndex };
		}
	}

	return undefined;
}

function detectShellKindFromIdentity(identity: string): ShellKind | undefined {
	if (/\b(cmd|cmd\.exe|command prompt)\b/.test(identity)) {
		return 'cmd';
	}

	if (/\b(pwsh|pwsh\.exe|powershell|powershell\.exe)\b/.test(identity)) {
		return 'powershell';
	}

	if (/\b(bash|bash\.exe|zsh|fish|sh|sh\.exe|dash|ksh)\b/.test(identity)) {
		return 'posix';
	}

	return undefined;
}

function isWslShell(wslIdentityIndex: number, detectedShell: DetectedShell | undefined) {
	if (wslIdentityIndex === -1) {
		return false;
	}

	return !detectedShell
		|| wslIdentityIndex <= detectedShell.sourceIndex
		|| (detectedShell.sourceIndex === 0 && detectedShell.kind === 'posix');
}

function looksLikeWsl(identity: string) {
	return /\b(wsl|wsl\.exe|ubuntu|debian|kali|alpine|suse|opensuse|fedora|pengwin)\b/.test(identity)
		|| identity.includes('source: wsl');
}

function looksLikeWslPath(fileSystemPath: string | undefined) {
	return fileSystemPath !== undefined && (
		/^\\\\(?:wsl\$|wsl\.localhost)\\/i.test(fileSystemPath)
		|| /^\/mnt\/[a-z](?:\/|$)/i.test(fileSystemPath)
	);
}

function getWslDistro(environment: ShellEnvironment) {
	if (environment.profileSource?.toLowerCase() === 'wsl') {
		return environment.defaultProfile;
	}

	return undefined;
}

function windowsPathToWsl(fileSystemPath: string) {
	if (fileSystemPath.startsWith('/')) {
		return fileSystemPath;
	}

	const wslUnc = /^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+\\?(.*)$/i.exec(fileSystemPath);
	if (wslUnc) {
		return `/${wslUnc[1].replaceAll('\\', '/')}`.replace(/\/$/, '') || '/';
	}

	const drivePath = /^([a-z]):[\\/](.*)$/i.exec(fileSystemPath);
	if (drivePath) {
		return `/mnt/${drivePath[1].toLowerCase()}/${drivePath[2].replaceAll('\\', '/')}`;
	}

	const uncPath = /^\\\\([^\\]+)\\([^\\]+)\\?(.*)$/i.exec(fileSystemPath);
	if (uncPath) {
		return `//${uncPath[1]}/${uncPath[2]}${uncPath[3] ? `/${uncPath[3].replaceAll('\\', '/')}` : ''}`;
	}

	return fileSystemPath.replaceAll('\\', '/');
}

function stripExtendedWindowsPrefix(fileSystemPath: string) {
	if (fileSystemPath.startsWith('\\\\?\\UNC\\')) {
		return `\\\\${fileSystemPath.slice(8)}`;
	}

	if (fileSystemPath.startsWith('\\\\?\\')) {
		return fileSystemPath.slice(4);
	}

	return fileSystemPath;
}

function isWindowsPath(fileSystemPath: string) {
	return /^[a-z]:[\\/]/i.test(fileSystemPath) || fileSystemPath.startsWith('\\\\');
}

function formatShellArgs(shellArgs: readonly string[] | string | undefined): string | undefined {
	if (typeof shellArgs === 'string' || shellArgs === undefined) {
		return shellArgs;
	}

	return shellArgs.join(' ');
}

function normalizeIdentity(identity: string | undefined) {
	return identity?.toLowerCase().trim() ?? '';
}
