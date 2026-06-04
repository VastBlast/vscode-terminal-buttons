import type * as vscode from 'vscode';

export function getRestartTerminalOptions(
	options: Readonly<vscode.TerminalOptions | vscode.ExtensionTerminalOptions>,
	terminalName: string,
): vscode.TerminalOptions | undefined {
	if ('pty' in options) {
		return undefined;
	}

	return {
		color: options.color,
		cwd: options.cwd,
		env: options.env,
		iconPath: options.iconPath,
		isTransient: options.isTransient,
		location: typeof options.location === 'number' ? options.location : undefined,
		message: options.message,
		name: options.name ?? terminalName,
		shellArgs: options.shellArgs,
		shellPath: options.shellPath,
		strictEnv: options.strictEnv,
	};
}
