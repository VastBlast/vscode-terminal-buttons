import { getPathParts } from './paths';
import type { RuntimeTools } from './runtimeTools';

export interface RunCommandTarget {
	fileSystemPath: string;
	hasBunLock: boolean;
	hasDenoConfig: boolean;
	isDirectory: boolean;
	isPowerShell: boolean;
	isWindowsTerminal: boolean;
	languageId?: string;
	tools: RuntimeTools;
}

export type RunCommandMap = Record<string, string>;

export function resolveRunCommand(target: RunCommandTarget, customCommands: RunCommandMap, enableDefaults = true): string | undefined {
	const customCommand = findCustomCommand(target, customCommands);
	if (customCommand) {
		return customCommand;
	}

	return enableDefaults ? getDefaultCommand(target) : undefined;
}

function findCustomCommand(target: RunCommandTarget, customCommands: RunCommandMap): string | undefined {
	const commands = new Map(
		Object.entries(customCommands)
			.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
			.map(([key, command]) => [key.trim().toLowerCase(), command.trim()] as const)
			.filter(([, command]) => command.length > 0),
	);

	if (target.isDirectory) {
		return commands.get('folder') ?? commands.get('directory') ?? commands.get('<folder>') ?? commands.get('default');
	}

	const parts = getPathParts(target.fileSystemPath);
	const candidates = [
		parts.basename.toLowerCase(),
		parts.extname,
		parts.extname && `*${parts.extname}`,
		parts.extname.slice(1),
		target.languageId?.toLowerCase(),
		'default',
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		const command = commands.get(candidate);
		if (command) {
			return command;
		}
	}

	return undefined;
}

function getDefaultCommand(target: RunCommandTarget): string | undefined {
	if (target.isDirectory) {
		return undefined;
	}

	const { extname } = getPathParts(target.fileSystemPath);
	const javascriptRuntime = withSubcommand(target.tools.deno, 'run', target.hasDenoConfig)
		?? runtimeWhen(target.tools.bun, target.hasBunLock)
		?? target.tools.node
		?? 'node';
	const typescriptRuntime = getTypeScriptRuntime(target, extname !== '.tsx');
	const pythonRuntime = target.isWindowsTerminal
		? target.tools.python ?? target.tools.py ?? target.tools.python3
		: target.tools.python3 ?? target.tools.python;

	switch (extname) {
		case '.cjs':
		case '.js':
		case '.mjs':
			return `${javascriptRuntime} \${runFile}`;
		case '.cts':
		case '.mts':
		case '.ts':
			return `${typescriptRuntime ?? 'node'} \${runFile}`;
		case '.tsx':
			return typescriptRuntime ? `${typescriptRuntime} \${runFile}` : undefined;
		case '.bash':
			return target.tools.bash ? `${target.tools.bash} \${runFile}` : undefined;
		case '.bat':
		case '.cmd':
			if (!target.isWindowsTerminal) {
				return undefined;
			}

			return target.isPowerShell ? '& ${runFile}' : '${runFile}';
		case '.fish':
			return target.tools.fish ? `${target.tools.fish} \${runFile}` : undefined;
		case '.go':
			return target.tools.go ? `${target.tools.go} run \${runFile}` : undefined;
		case '.java':
			return target.tools.java ? `${target.tools.java} \${runFile}` : undefined;
		case '.jl':
			return target.tools.julia ? `${target.tools.julia} \${runFile}` : undefined;
		case '.kts':
			return target.tools.kotlinc ? `${target.tools.kotlinc} -script \${runFile}` : undefined;
		case '.lua':
			return target.tools.lua ? `${target.tools.lua} \${runFile}` : undefined;
		case '.m':
			return ['matlab', 'octave'].includes(target.languageId ?? '') && target.tools.octave ? `${target.tools.octave} \${runFile}` : undefined;
		case '.php':
			return target.tools.php ? `${target.tools.php} \${runFile}` : undefined;
		case '.pl':
			return target.tools.perl ? `${target.tools.perl} \${runFile}` : undefined;
		case '.ps1':
			return target.isPowerShell
				? '& ${runFile}'
				: target.tools.pwsh || target.tools.powershell
					? `${target.tools.pwsh ?? target.tools.powershell} -File \${runFile}`
					: undefined;
		case '.py':
			return pythonRuntime ? `${pythonRuntime} \${runFile}` : undefined;
		case '.r':
			return target.tools.Rscript ? `${target.tools.Rscript} \${runFile}` : undefined;
		case '.rb':
			return target.tools.ruby ? `${target.tools.ruby} \${runFile}` : undefined;
		case '.sh': {
			const shellRuntime = target.tools.bash ?? target.tools.sh;
			return shellRuntime ? `${shellRuntime} \${runFile}` : undefined;
		}
		case '.swift':
			return target.tools.swift ? `${target.tools.swift} \${runFile}` : undefined;
		case '.zsh':
			return target.tools.zsh ? `${target.tools.zsh} \${runFile}` : undefined;
		default:
			return undefined;
	}
}

function getTypeScriptRuntime(target: RunCommandTarget, allowNodeFallback: boolean) {
	return withSubcommand(target.tools.deno, 'run', target.hasDenoConfig)
		?? runtimeWhen(target.tools.bun, target.hasBunLock)
		?? target.tools.tsx
		?? target.tools['ts-node']
		?? (allowNodeFallback ? target.tools.node : undefined);
}

function runtimeWhen(command: string | undefined, condition: boolean) {
	return condition ? command : undefined;
}

function withSubcommand(command: string | undefined, subcommand: string, condition = true) {
	return condition && command ? `${command} ${subcommand}` : undefined;
}
