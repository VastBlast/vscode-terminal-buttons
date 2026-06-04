import * as vscode from 'vscode';
import { getContainedRelativePath, getPathParts, getRelativePath } from './paths';
import { resolveRunCommand, type RunCommandMap } from './runCommands';
import { RuntimeDetector } from './runtimeTools';
import { getRestartTerminalOptions } from './terminalRestart';
import {
	cdCommand,
	expandCommandTemplate,
	getShellContext,
	shellQuote,
	toTerminalPath,
	type PathStyle,
	type ShellContext,
	type ShellEnvironment,
} from './shell';

const commandPrefix = 'simple-terminal-controls';
const configPrefix = 'simpleTerminalControls';
const defaultTerminalName = 'Simple Terminal Controls';
const defaultButtonColors = {
	cd: '#00D7FF',
	run: '#00FF66',
	stop: '#FF3B30',
};
type StopBehavior = 'dispose' | 'interrupt' | 'restart';

interface ExtensionConfig {
	autoDetectRuntimes: boolean;
	colors: Record<keyof typeof defaultButtonColors, string>;
	enableDefaultRunCommands: boolean;
	pathStyle: PathStyle;
	preferActiveTerminal: boolean;
	runCommands: RunCommandMap;
	statusBarPriority: number;
	stopBehavior: StopBehavior;
	tools: Record<string, string>;
	terminalName: string;
}

interface Target {
	cwd: string;
	fileSystemPath: string;
	isDirectory: boolean;
	languageId?: string;
	workspaceFolder?: vscode.WorkspaceFolder;
}

interface TerminalProfile {
	path?: string | string[];
	source?: string;
}

export function activate(context: vscode.ExtensionContext): void {
	const controller = new SimpleTerminalControlsController();
	controller.register(context);
}

class SimpleTerminalControlsController {
	private managedTerminal: vscode.Terminal | undefined;
	private readonly runtimeDetector = new RuntimeDetector();
	private readonly statusBarItems: vscode.StatusBarItem[] = [];
	private readonly terminalPathStyles = new WeakMap<vscode.Terminal, PathStyle>();

	register(context: vscode.ExtensionContext): void {
		this.refreshStatusBar();

		context.subscriptions.push(
			vscode.commands.registerCommand(`${commandPrefix}.run`, (resource?: vscode.Uri, resources?: vscode.Uri[]) => this.run(resource, resources)),
			vscode.commands.registerCommand(`${commandPrefix}.stop`, () => this.stop()),
			vscode.commands.registerCommand(`${commandPrefix}.cd`, (resource?: vscode.Uri, resources?: vscode.Uri[]) => this.cd(resource, resources)),
			vscode.commands.registerCommand(`${commandPrefix}.setTerminalPathStyle`, () => this.setTerminalPathStyle()),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(configPrefix)) {
					this.runtimeDetector.clear();
					if (event.affectsConfiguration(`${configPrefix}.colors`) || event.affectsConfiguration(`${configPrefix}.statusBarPriority`)) {
						this.refreshStatusBar();
					}
				}
			}),
			vscode.window.onDidCloseTerminal(terminal => {
				if (terminal === this.managedTerminal) {
					this.managedTerminal = undefined;
				}
			}),
			{ dispose: () => this.managedTerminal?.dispose() },
			{ dispose: () => this.disposeStatusBarItems() },
		);
	}

	private async run(resource?: vscode.Uri, resources?: vscode.Uri[]): Promise<void> {
		const target = await this.resolveTarget(resource, resources);
		if (!target) {
			return;
		}

		const config = readConfig();
		const terminal = this.getTerminal(config);
		const shellContext = getShellContext(this.getShellEnvironment(terminal, this.getPathStyle(terminal, config)));
		const runtimeInfo = await this.runtimeDetector.detect({
			autoDetect: config.autoDetectRuntimes,
			cwd: target.cwd,
			fileSystemPath: target.fileSystemPath,
			languageId: target.languageId,
			shellContext,
			toolCommands: config.tools,
			workspaceFolder: target.workspaceFolder?.uri.fsPath,
		});
		const commandTemplate = resolveRunCommand({
			fileSystemPath: target.fileSystemPath,
			hasBunLock: runtimeInfo.hasBunLock,
			hasDenoConfig: runtimeInfo.hasDenoConfig,
			isDirectory: target.isDirectory,
			isPowerShell: shellContext.kind === 'powershell',
			isWindowsTerminal: shellContext.kind !== 'posix' && !shellContext.isWsl,
			languageId: target.languageId,
			tools: runtimeInfo.tools,
		}, config.runCommands, config.enableDefaultRunCommands);

		if (!commandTemplate) {
			const subject = target.isDirectory ? 'folder' : getPathParts(target.fileSystemPath).extname || 'file type';
			void vscode.window.showWarningMessage(`No run command is configured for this ${subject}. Configure simpleTerminalControls.runCommands to add one.`);
			return;
		}

		const command = expandCommandTemplate(commandTemplate, buildCommandVariables(target, shellContext, getTerminalCwd(terminal.shellIntegration?.cwd, shellContext)));
		await this.execute(terminal, command);
	}

	private async cd(resource?: vscode.Uri, resources?: vscode.Uri[]): Promise<void> {
		const target = await this.resolveTarget(resource, resources);
		if (!target) {
			return;
		}

		const config = readConfig();
		const terminal = this.getTerminal(config);
		const shellContext = getShellContext(this.getShellEnvironment(terminal, this.getPathStyle(terminal, config)));
		await this.execute(terminal, cdCommand(target.cwd, shellContext));
	}

	private stop(): void {
		const config = readConfig();
		const terminal = vscode.window.activeTerminal ?? this.managedTerminal;
		if (!terminal) {
			this.managedTerminal = this.createManagedTerminal(config);
			this.managedTerminal.show();
			return;
		}

		if (config.stopBehavior === 'interrupt') {
			terminal.show();
			// Avoid appending the command to partially typed input when shell integration is unavailable.
			terminal.sendText('\x03', false);
			return;
		}

		if (config.stopBehavior === 'dispose') {
			terminal.dispose();
			return;
		}

		const wasManaged = terminal === this.managedTerminal;
		const replacementOptions = getRestartTerminalOptions(terminal.creationOptions, terminal.name);
		this.terminalPathStyles.delete(terminal);
		if (wasManaged) {
			this.managedTerminal = undefined;
		}

		terminal.dispose();

		const replacement = replacementOptions
			? vscode.window.createTerminal(replacementOptions)
			: this.createManagedTerminal(config);
		if (wasManaged || !replacementOptions) {
			this.managedTerminal = replacement;
		}
		replacement.show();
	}

	private async setTerminalPathStyle(): Promise<void> {
		const terminal = vscode.window.activeTerminal ?? this.managedTerminal;
		if (!terminal) {
			void vscode.window.showInformationMessage('No active terminal to configure.');
			return;
		}

		const selected = await vscode.window.showQuickPick([
			{ label: 'Auto', pathStyle: 'auto' as const, description: 'Use profile and shell-integration detection' },
			{ label: 'Native', pathStyle: 'native' as const, description: 'Use native host paths for this terminal' },
			{ label: 'WSL', pathStyle: 'wsl' as const, description: 'Convert Windows paths to /mnt paths for this terminal' },
		], {
			placeHolder: `Path mode for ${terminal.name}`,
		});

		if (!selected) {
			return;
		}

		if (selected.pathStyle === 'auto') {
			this.terminalPathStyles.delete(terminal);
		} else {
			this.terminalPathStyles.set(terminal, selected.pathStyle);
		}

		void vscode.window.showInformationMessage(`Simple Terminal Controls path mode for ${terminal.name}: ${selected.label}`);
	}

	private async resolveTarget(resource?: vscode.Uri, resources?: vscode.Uri[]): Promise<Target | undefined> {
		const uri = resource ?? resources?.[0] ?? vscode.window.activeTextEditor?.document.uri;
		if (!uri) {
			void vscode.window.showWarningMessage('Open or select a file or folder first.');
			return undefined;
		}

		if (uri.scheme !== 'file') {
			void vscode.window.showWarningMessage(`Simple Terminal Controls only supports file-system resources. Received '${uri.scheme}'.`);
			return undefined;
		}

		const stat = await statFile(uri);
		if (!stat) {
			void vscode.window.showWarningMessage(`Cannot access ${uri.fsPath}.`);
			return undefined;
		}

		const isDirectory = Boolean(stat.type & vscode.FileType.Directory);
		const fileSystemPath = uri.fsPath;
		const cwd = isDirectory ? fileSystemPath : getPathParts(fileSystemPath).dirname;
		const activeDocument = vscode.window.activeTextEditor?.document;
		const languageId = activeDocument?.uri.toString() === uri.toString() ? activeDocument.languageId : undefined;

		return {
			cwd,
			fileSystemPath,
			isDirectory,
			languageId,
			workspaceFolder: vscode.workspace.getWorkspaceFolder(uri),
		};
	}

	private getTerminal(config: ExtensionConfig): vscode.Terminal {
		if (config.preferActiveTerminal && vscode.window.activeTerminal) {
			vscode.window.activeTerminal.show();
			return vscode.window.activeTerminal;
		}

		this.managedTerminal ??= this.createManagedTerminal(config);

		this.managedTerminal.show();
		return this.managedTerminal;
	}

	private createManagedTerminal(config: ExtensionConfig) {
		return vscode.window.createTerminal({
			iconPath: new vscode.ThemeIcon('terminal'),
			isTransient: true,
			name: config.terminalName,
		});
	}

	private refreshStatusBar(): void {
		this.disposeStatusBarItems();
		const { colors, statusBarPriority } = readConfig();
		this.statusBarItems.push(
			this.createStatusBarItem('run', '$(play) Run', `${commandPrefix}.run`, 'Run the active or selected file', statusBarPriority + 2, colors.run),
			this.createStatusBarItem('stop', '$(debug-stop) Stop', `${commandPrefix}.stop`, 'Restart the active terminal', statusBarPriority + 1, colors.stop),
			this.createStatusBarItem('cd', '$(terminal) CD', `${commandPrefix}.cd`, 'Change terminal directory to the active or selected item', statusBarPriority, colors.cd),
		);
	}

	private disposeStatusBarItems(): void {
		for (const item of this.statusBarItems.splice(0)) {
			item.dispose();
		}
	}

	private async execute(terminal: vscode.Terminal, command: string): Promise<void> {
		terminal.show();

		try {
			terminal.shellIntegration?.executeCommand(command);
			if (terminal.shellIntegration) {
				return;
			}
		} catch {
			// Task terminals and unsupported shells can reject shell integration commands.
		}

		terminal.sendText(command, true);
	}

	private getShellEnvironment(terminal: vscode.Terminal, pathStyle: PathStyle): ShellEnvironment {
		const options = terminal.creationOptions;
		const terminalOptions = 'pty' in options ? undefined : options;
		const profile = getDefaultTerminalProfile();
		const cwd = terminal.shellIntegration?.cwd;

		return {
			currentWorkingDirectory: cwd ? getReportedTerminalCwd(cwd) : undefined,
			defaultProfile: profile.name,
			pathStyle,
			platform: process.platform,
			profileShellPath: profile.shellPath,
			profileSource: profile.source,
			remoteName: vscode.env.remoteName,
			shellArgs: terminalOptions?.shellArgs,
			shellPath: terminalOptions?.shellPath,
			terminalName: terminal.name,
			terminalStateShell: terminal.state.shell,
		};
	}

	private getPathStyle(terminal: vscode.Terminal, config: ExtensionConfig) {
		return this.terminalPathStyles.get(terminal) ?? config.pathStyle;
	}

	private createStatusBarItem(id: string, text: string, command: string, tooltip: string, priority: number, color: string): vscode.StatusBarItem {
		const item = vscode.window.createStatusBarItem(`${commandPrefix}.status.${id}`, vscode.StatusBarAlignment.Right, priority);
		item.name = `Simple Terminal Controls: ${id}`;
		item.text = text;
		item.color = color;
		item.command = command;
		item.tooltip = tooltip;
		item.accessibilityInformation = { label: `Simple Terminal Controls: ${tooltip}`, role: 'button' };
		item.show();
		return item;
	}
}

function readConfig(): ExtensionConfig {
	const config = vscode.workspace.getConfiguration(configPrefix);
	const pathStyle = config.get<unknown>('pathStyle');
	const statusBarPriority = config.get<unknown>('statusBarPriority');
	const stopBehavior = config.get<unknown>('stopBehavior');
	const terminalName = config.get<unknown>('terminalName');
	const colors = readStringMap(config, 'colors');

	return {
		autoDetectRuntimes: readBoolean(config, 'autoDetectRuntimes', true),
		colors: {
			cd: colors.cd?.trim() || defaultButtonColors.cd,
			run: colors.run?.trim() || defaultButtonColors.run,
			stop: colors.stop?.trim() || defaultButtonColors.stop,
		},
		enableDefaultRunCommands: readBoolean(config, 'enableDefaultRunCommands', true),
		pathStyle: pathStyle === 'native' || pathStyle === 'wsl' ? pathStyle : 'auto',
		preferActiveTerminal: readBoolean(config, 'preferActiveTerminal', true),
		runCommands: readStringMap(config, 'runCommands'),
		statusBarPriority: typeof statusBarPriority === 'number' && Number.isFinite(statusBarPriority) ? statusBarPriority : 10,
		stopBehavior: stopBehavior === 'interrupt' || stopBehavior === 'dispose' ? stopBehavior : 'restart',
		tools: readStringMap(config, 'tools'),
		terminalName: typeof terminalName === 'string' && terminalName.trim() ? terminalName.trim() : defaultTerminalName,
	};
}

function readBoolean(config: vscode.WorkspaceConfiguration, key: string, fallback: boolean) {
	const value = config.get<unknown>(key);
	return typeof value === 'boolean' ? value : fallback;
}

function readStringMap(config: vscode.WorkspaceConfiguration, key: string) {
	const value = config.get<unknown>(key);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function buildCommandVariables(target: Target, shellContext: ShellContext, terminalCwd?: string): Record<string, string> {
	const parts = getPathParts(target.fileSystemPath);
	const workspaceFolder = target.workspaceFolder?.uri.fsPath ?? target.cwd;
	const relativeFile = target.workspaceFolder
		? getRelativePath(target.workspaceFolder.uri.fsPath, target.fileSystemPath)
		: parts.basename;

	const pathValues = {
		file: target.fileSystemPath,
		fileDirname: target.cwd,
		folder: target.cwd,
		relativeFile,
		workspaceFolder,
	};

	const variables: Record<string, string> = {
		fileBasename: shellQuote(parts.basename, shellContext.kind),
		fileBasenameNoExtension: shellQuote(parts.basenameNoExtension, shellContext.kind),
		fileBasenameNoExtensionRaw: parts.basenameNoExtension,
		fileBasenameRaw: parts.basename,
		fileExtname: parts.extname,
	};

	for (const [name, value] of Object.entries(pathValues)) {
		const terminalPath = toTerminalPath(value, shellContext);
		variables[name] = shellQuote(terminalPath, shellContext.kind);
		variables[`${name}Raw`] = terminalPath;
	}

	const runFileRaw = terminalCwd
		? formatRelativeRunPath(getContainedRelativePath(terminalCwd, variables.fileRaw), shellContext) ?? variables.fileRaw
		: variables.fileRaw;
	variables.runFile = shellQuote(runFileRaw, shellContext.kind);
	variables.runFileRaw = runFileRaw;

	return variables;
}

function formatRelativeRunPath(relativePath: string | undefined, shellContext: ShellContext) {
	if (!relativePath) {
		return undefined;
	}

	const normalized = shellContext.kind === 'posix' ? relativePath.replaceAll('\\', '/') : relativePath;
	const separator = normalized.includes('\\') ? '\\' : '/';
	return normalized.startsWith(`.${separator}`) ? normalized : `.${separator}${normalized}`;
}

async function statFile(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
	try {
		return await vscode.workspace.fs.stat(uri);
	} catch {
		return undefined;
	}
}

function getDefaultTerminalProfile(): { name?: string; shellPath?: string; source?: string } {
	const platformKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
	const config = vscode.workspace.getConfiguration('terminal.integrated');
	const name = config.get<string>(`defaultProfile.${platformKey}`);
	const profiles = config.get<Record<string, TerminalProfile>>(`profiles.${platformKey}`);
	const profile = name ? profiles?.[name] : undefined;
	const shellPath = Array.isArray(profile?.path) ? profile.path.join(' ') : profile?.path;

	return {
		name,
		shellPath,
		source: profile?.source,
	};
}

function getReportedTerminalCwd(cwd: vscode.Uri) {
	if (/^\\\\(?:wsl\$|wsl\.localhost)\\/i.test(cwd.fsPath)) {
		return cwd.fsPath;
	}

	return cwd.path;
}

function getTerminalCwd(cwd: vscode.Uri | undefined, shellContext: ShellContext) {
	if (!cwd) {
		return undefined;
	}

	return toTerminalPath(shellContext.pathStyle === 'wsl' ? getReportedTerminalCwd(cwd) : cwd.fsPath, shellContext);
}
