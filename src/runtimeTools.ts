import { constants as fsConstants } from 'fs';
import { access } from 'fs/promises';
import { execFile, type ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import { getPathApi, getPathParts, isPathWithinOrEqual, isSamePath } from './paths';
import { executablePathCommand, type ShellContext } from './shell';

export type ToolName =
	| 'Rscript'
	| 'bash'
	| 'bun'
	| 'cmd'
	| 'deno'
	| 'fish'
	| 'go'
	| 'java'
	| 'julia'
	| 'kotlinc'
	| 'lua'
	| 'node'
	| 'octave'
	| 'perl'
	| 'php'
	| 'powershell'
	| 'pwsh'
	| 'py'
	| 'python'
	| 'python3'
	| 'ruby'
	| 'sh'
	| 'swift'
	| 'ts-node'
	| 'tsx'
	| 'zsh';

export type RuntimeTools = Partial<Record<ToolName, string>>;

export interface RuntimeInfo {
	hasBunLock: boolean;
	hasDenoConfig: boolean;
	tools: RuntimeTools;
}

export interface RuntimeDetectionRequest {
	autoDetect: boolean;
	cwd: string;
	fileSystemPath: string;
	languageId?: string;
	shellContext: ShellContext;
	toolCommands: Record<string, string>;
	workspaceFolder?: string;
}

const exec = promisify(execFile);
type CommandProbe = (file: string, args: string[], options: ExecFileOptions & { timeout: number }) => Promise<unknown>;

export class RuntimeDetector {
	private readonly toolCache = new Map<string, Promise<string | undefined>>();

	constructor(private readonly commandProbe: CommandProbe = exec) {}

	async detect(request: RuntimeDetectionRequest): Promise<RuntimeInfo> {
		const directories = getSearchDirectories(request.cwd, request.workspaceFolder);
		const candidates = getToolCandidates(request.fileSystemPath, request.shellContext, request.languageId);
		const checksJavaScriptProject = candidates.includes('bun') || candidates.includes('deno');
		const hasBunLock = checksJavaScriptProject && await this.hasAnyFile(directories, ['bun.lock', 'bun.lockb']);
		const hasDenoConfig = checksJavaScriptProject && await this.hasAnyFile(directories, ['deno.json', 'deno.jsonc']);
		const tools = await this.detectTools(candidates.filter(tool =>
			(tool !== 'bun' || hasBunLock) && (tool !== 'deno' || hasDenoConfig),
		), directories, request);

		return {
			hasBunLock,
			hasDenoConfig,
			tools,
		};
	}

	clear(): void {
		this.toolCache.clear();
	}

	private async detectTools(candidates: ToolName[], directories: string[], request: RuntimeDetectionRequest) {
		const tools: RuntimeTools = {};

		await Promise.all(candidates.map(async tool => {
			const command = await this.resolveTool(tool, directories, request);
			if (command) {
				tools[tool] = command;
			}
		}));

		return tools;
	}

	private async resolveTool(tool: ToolName, directories: string[], request: RuntimeDetectionRequest) {
		const configuredCommand = getConfiguredTool(tool, request.toolCommands);
		if (configuredCommand) {
			return formatConfiguredTool(configuredCommand, request.shellContext);
		}

		const localBin = await this.findLocalBin(tool, directories, request.shellContext);
		if (localBin) {
			return localBin;
		}

		if (!request.autoDetect) {
			return undefined;
		}

		return this.commandExists(tool, request.shellContext);
	}

	private async findLocalBin(tool: ToolName, directories: string[], shellContext: ShellContext) {
		if (!['ts-node', 'tsx'].includes(tool)) {
			return undefined;
		}

		for (const directory of directories) {
			const pathApi = getPathApi(directory);
			for (const fileName of localBinFileNames(tool, shellContext)) {
				const fileSystemPath = pathApi.join(directory, 'node_modules', '.bin', fileName);
				if (await this.fileExists(fileSystemPath)) {
					return executablePathCommand(fileSystemPath, shellContext);
				}
			}
		}

		return undefined;
	}

	private commandExists(tool: ToolName, shellContext: ShellContext) {
		const cacheKey = [
			'cmd',
			process.platform,
			shellContext.isWsl ? `wsl:${shellContext.wslDistro ?? ''}` : process.env.PATH ?? '',
			tool,
		].join(':');
		let command = this.toolCache.get(cacheKey);
		if (!command) {
			command = this.commandExistsUncached(tool, shellContext);
			this.toolCache.set(cacheKey, command);
		}

		return command;
	}

	private async commandExistsUncached(tool: ToolName, shellContext: ShellContext) {
		try {
			if (process.platform === 'win32') {
				if (shellContext.isWsl) {
					const distroArgs = shellContext.wslDistro ? ['-d', shellContext.wslDistro] : [];
					await this.commandProbe('wsl.exe', [...distroArgs, 'sh', '-lc', `command -v ${tool}`], { windowsHide: true, timeout: 1500 });
				} else {
					await this.commandProbe('where.exe', [tool], { windowsHide: true, timeout: 1500 });
				}
			} else {
				await this.commandProbe('sh', ['-lc', `command -v ${tool}`], { timeout: 1500 });
			}

			return tool;
		} catch {
			return undefined;
		}
	}

	private async hasAnyFile(directories: string[], fileNames: string[]) {
		for (const directory of directories) {
			const pathApi = getPathApi(directory);
			for (const fileName of fileNames) {
				if (await this.fileExists(pathApi.join(directory, fileName))) {
					return true;
				}
			}
		}

		return false;
	}

	private fileExists(fileSystemPath: string) {
		return access(fileSystemPath, fsConstants.F_OK).then(() => true, () => false);
	}
}

export function getToolCandidates(fileSystemPath: string, shellContext: ShellContext, languageId?: string): ToolName[] {
	const { extname } = getPathParts(fileSystemPath);
	const windowsTools: ToolName[] = shellContext.kind === 'posix' || shellContext.isWsl ? [] : ['cmd'];

	switch (extname) {
		case '.cjs':
		case '.js':
		case '.mjs':
			return ['deno', 'bun', 'node'];
		case '.cts':
		case '.mts':
		case '.ts':
			return ['deno', 'bun', 'tsx', 'ts-node', 'node'];
		case '.tsx':
			return ['deno', 'bun', 'tsx', 'ts-node'];
		case '.bash':
			return ['bash'];
		case '.bat':
		case '.cmd':
			return windowsTools;
		case '.fish':
			return ['fish'];
		case '.go':
			return ['go'];
		case '.java':
			return ['java'];
		case '.jl':
			return ['julia'];
		case '.kts':
			return ['kotlinc'];
		case '.lua':
			return ['lua'];
		case '.m':
			return ['matlab', 'octave'].includes(languageId ?? '') ? ['octave'] : [];
		case '.php':
			return ['php'];
		case '.pl':
			return ['perl'];
		case '.ps1':
			return shellContext.kind === 'powershell' ? [] : ['pwsh', 'powershell'];
		case '.py':
			return shellContext.kind === 'posix' ? ['python3', 'python'] : ['python', 'py', 'python3'];
		case '.r':
			return ['Rscript'];
		case '.rb':
			return ['ruby'];
		case '.sh':
			return ['bash', 'sh'];
		case '.swift':
			return ['swift'];
		case '.zsh':
			return ['zsh'];
		default:
			return [];
	}
}

function getConfiguredTool(tool: ToolName, toolCommands: Record<string, string>) {
	const normalizedTool = tool.toLowerCase();
	const entry = Object.entries(toolCommands).find(([key, command]) =>
		key.trim().toLowerCase() === normalizedTool && typeof command === 'string',
	);
	return entry?.[1].trim();
}

export function getSearchDirectories(cwd: string, workspaceFolder?: string) {
	if (!workspaceFolder) {
		return [cwd];
	}

	const pathApi = getPathApi(cwd);
	const directories = [];
	let current = cwd;
	const stopAt = pathApi.resolve(workspaceFolder);

	while (true) {
		directories.push(current);

		if (isSamePath(current, stopAt)) {
			break;
		}

		const parent = pathApi.dirname(current);
		if (parent === current || !isPathWithinOrEqual(stopAt, parent)) {
			break;
		}

		current = parent;
	}

	if (!directories.some(directory => isSamePath(directory, stopAt))) {
		directories.push(workspaceFolder);
	}

	return uniqueDirectories(directories);
}

function formatConfiguredTool(command: string, shellContext: ShellContext) {
	return looksLikePath(command) ? executablePathCommand(command, shellContext) : command;
}

function looksLikePath(command: string) {
	return /^[a-z]:/i.test(command)
		|| command.startsWith('\\\\')
		|| command.startsWith('/')
		|| command.startsWith('./')
		|| command.startsWith('../')
		|| command.startsWith('.\\')
		|| command.startsWith('..\\');
}

function localBinFileNames(tool: ToolName, shellContext: ShellContext) {
	if (shellContext.kind === 'posix') {
		return [tool];
	}

	return [`${tool}.cmd`, `${tool}.exe`, tool];
}

function uniqueDirectories(directories: string[]) {
	const unique: string[] = [];

	for (const directory of directories) {
		if (!unique.some(existing => isSamePath(existing, directory))) {
			unique.push(directory);
		}
	}

	return unique;
}
