import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cdCommand, executablePathCommand, expandCommandTemplate, getShellContext, shellQuote, toTerminalPath } from '../shell';

describe('shell helpers', () => {
	it('detects WSL terminals on Windows and converts drive paths', () => {
		const context = getShellContext({
			defaultProfile: 'Ubuntu',
			pathStyle: 'auto',
			platform: 'win32',
		});

		assert.equal(context.isWsl, true);
		assert.equal(context.kind, 'posix');
		assert.equal(toTerminalPath('C:\\Users\\Me\\project\\file.ts', context), '/mnt/c/Users/Me/project/file.ts');
	});

	it('honors an explicit WSL path style even when shell identity is generic', () => {
		const context = getShellContext({
			pathStyle: 'wsl',
			platform: 'win32',
			shellPath: 'bash.exe',
		});

		assert.equal(context.isWsl, true);
		assert.equal(toTerminalPath('D:\\work\\app', context), '/mnt/d/work/app');
	});

	it('detects WSL from a reported terminal cwd in auto mode', () => {
		const context = getShellContext({
			currentWorkingDirectory: '/mnt/c/Users/Me/project',
			defaultProfile: 'Command Prompt',
			pathStyle: 'auto',
			platform: 'win32',
		});

		assert.equal(context.isWsl, true);
		assert.equal(context.kind, 'posix');
		assert.equal(toTerminalPath('C:\\Users\\Me\\project\\file.ts', context), '/mnt/c/Users/Me/project/file.ts');
	});

	it('detects WSL from the live terminal shell state', () => {
		const context = getShellContext({
			defaultProfile: 'Command Prompt',
			pathStyle: 'auto',
			platform: 'win32',
			terminalStateShell: 'wsl',
		});

		assert.equal(context.isWsl, true);
		assert.equal(context.kind, 'posix');
		assert.equal(toTerminalPath('C:\\Users\\Me\\project\\file.ts', context), '/mnt/c/Users/Me/project/file.ts');
	});

	it('does not treat normal Windows cwd reports as WSL', () => {
		const context = getShellContext({
			currentWorkingDirectory: '/c:/Users/Me/project',
			defaultProfile: 'Command Prompt',
			pathStyle: 'auto',
			platform: 'win32',
		});

		assert.equal(context.isWsl, false);
		assert.equal(context.kind, 'cmd');
	});

	it('converts WSL UNC paths to Linux paths', () => {
		const context = getShellContext({
			pathStyle: 'wsl',
			platform: 'win32',
		});

		assert.equal(toTerminalPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\project', context), '/home/me/project');
		assert.equal(toTerminalPath('\\\\wsl$\\Ubuntu', context), '/');
	});

	it('strips extended Windows path prefixes before conversion', () => {
		assert.equal(
			toTerminalPath('\\\\?\\C:\\Users\\Me\\project', getShellContext({ pathStyle: 'wsl', platform: 'win32' })),
			'/mnt/c/Users/Me/project',
		);
		assert.equal(
			toTerminalPath('\\\\?\\UNC\\server\\share\\project', getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'pwsh.exe' })),
			'\\\\server\\share\\project',
		);
	});

	it('keeps remote WSL paths native', () => {
		const context = getShellContext({
			pathStyle: 'auto',
			platform: 'linux',
			remoteName: 'wsl',
		});

		assert.equal(context.isWsl, false);
		assert.equal(context.kind, 'posix');
		assert.equal(toTerminalPath('/home/me/project/file.ts', context), '/home/me/project/file.ts');
	});

	it('detects common shell kinds from profile data', () => {
		assert.equal(getShellContext({ pathStyle: 'auto', platform: 'win32', shellPath: 'cmd.exe' }).kind, 'cmd');
		assert.equal(getShellContext({ pathStyle: 'auto', platform: 'win32', defaultProfile: 'PowerShell' }).kind, 'powershell');
		assert.equal(getShellContext({ pathStyle: 'auto', platform: 'darwin', shellPath: '/bin/zsh' }).kind, 'posix');
	});

	it('prefers the live terminal shell over default profile data', () => {
		const context = getShellContext({
			defaultProfile: 'Command Prompt',
			pathStyle: 'auto',
			platform: 'win32',
			terminalStateShell: 'powershell',
		});

		assert.equal(context.kind, 'powershell');
		assert.equal(
			cdCommand('C:\\Users\\Me\\My Project', context),
			"Set-Location -LiteralPath 'C:\\Users\\Me\\My Project'",
		);
	});

	it('does not let a WSL default profile override a live PowerShell terminal', () => {
		const context = getShellContext({
			defaultProfile: 'Ubuntu',
			pathStyle: 'auto',
			platform: 'win32',
			profileSource: 'WSL',
			terminalStateShell: 'pwsh',
		});

		assert.equal(context.isWsl, false);
		assert.equal(context.kind, 'powershell');
	});

	it('does not let a WSL default profile override a named native terminal', () => {
		const context = getShellContext({
			defaultProfile: 'Ubuntu',
			pathStyle: 'auto',
			platform: 'win32',
			profileSource: 'WSL',
			terminalName: 'Git Bash',
		});

		assert.equal(context.isWsl, false);
		assert.equal(context.kind, 'posix');
	});

	it('quotes cd commands for PowerShell, POSIX, and cmd shells', () => {
		assert.equal(
			cdCommand('C:\\Users\\Me\\My Project', getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'pwsh.exe' })),
			"Set-Location -LiteralPath 'C:\\Users\\Me\\My Project'",
		);
		assert.equal(
			cdCommand('/tmp/a b', getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' })),
			"cd -- '/tmp/a b'",
		);
		assert.equal(
			cdCommand('C:\\Users\\Me\\My Project', getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'cmd.exe' })),
			'cd /d "C:\\Users\\Me\\My Project"',
		);
	});

	it('quotes shell arguments without losing special characters', () => {
		assert.equal(shellQuote("/tmp/it's fine", 'posix'), "'/tmp/it'\\''s fine'");
		assert.equal(shellQuote("C:\\It's fine", 'powershell'), "'C:\\It''s fine'");
		assert.equal(shellQuote('C:\\100% "ok"', 'cmd'), '"C:\\100^% ""ok"""');
	});

	it('formats executable paths for direct invocation', () => {
		assert.equal(
			executablePathCommand('C:\\Program Files\\Tool\\tool.exe', getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'pwsh.exe' })),
			"& 'C:\\Program Files\\Tool\\tool.exe'",
		);
		assert.equal(
			executablePathCommand('/opt/my tool/bin/run', getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' })),
			"'/opt/my tool/bin/run'",
		);
	});

	it('expands known template variables and leaves unknown variables intact', () => {
		assert.equal(
			expandCommandTemplate('runner ${file} ${missing} ${fileBasename}', {
				file: "'/tmp/app.ts'",
				fileBasename: "'app.ts'",
			}),
			"runner '/tmp/app.ts' ${missing} 'app.ts'",
		);
	});
});
