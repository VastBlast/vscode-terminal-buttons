import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type * as vscode from 'vscode';
import { getRestartTerminalOptions } from '../terminalRestart';

describe('terminal restart options', () => {
	it('preserves normal terminal launch options', () => {
		const restartOptions = getRestartTerminalOptions({
			cwd: 'C:\\repo',
			env: { NODE_ENV: 'test' },
			isTransient: true,
			location: 2 as vscode.TerminalLocation,
			message: 'hello',
			name: 'PowerShell',
			shellArgs: ['-NoLogo'],
			shellPath: 'pwsh.exe',
			strictEnv: true,
		}, 'Terminal');

		assert.equal(restartOptions?.name, 'PowerShell');
		assert.equal(restartOptions?.shellPath, 'pwsh.exe');
		assert.deepEqual(restartOptions?.shellArgs, ['-NoLogo']);
		assert.equal(restartOptions?.cwd, 'C:\\repo');
		assert.deepEqual(restartOptions?.env, { NODE_ENV: 'test' });
		assert.equal(restartOptions?.strictEnv, true);
		assert.equal(restartOptions?.isTransient, true);
		assert.equal(restartOptions?.location, 2);
		assert.equal(restartOptions?.message, 'hello');
	});

	it('uses the current terminal name when creation options do not include one', () => {
		const options = getRestartTerminalOptions({}, 'zsh');

		assert.equal(options?.name, 'zsh');
	});

	it('does not clone extension-owned PTY terminals', () => {
		const options = getRestartTerminalOptions({
			name: 'Task',
			pty: {} as vscode.Pseudoterminal,
		}, 'Task');

		assert.equal(options, undefined);
	});

	it('does not reuse split-parent locations', () => {
		const options = getRestartTerminalOptions({
			location: { parentTerminal: {} as vscode.Terminal },
			name: 'Split',
		}, 'Split');

		assert.equal(options?.location, undefined);
	});
});
