import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRunCommand, type RunCommandMap, type RunCommandTarget } from '../runCommands';

const baseTarget: RunCommandTarget = {
	fileSystemPath: '/workspace/src/index.ts',
	hasBunLock: false,
	hasDenoConfig: false,
	isDirectory: false,
	isPowerShell: false,
	isWindowsTerminal: false,
	tools: {},
};

function target(overrides: Partial<RunCommandTarget>) {
	return {
		...baseTarget,
		...overrides,
		tools: {
			...baseTarget.tools,
			...overrides.tools,
		},
	};
}

describe('run command resolution', () => {
	it('uses default commands for common JavaScript and TypeScript files', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/index.js',
			tools: { node: 'node' },
		}), {}), 'node ${runFile}');

		assert.equal(resolveRunCommand(target({
			tools: { tsx: 'tsx', node: 'node' },
		}), {}), 'tsx ${runFile}');

		assert.equal(resolveRunCommand(target({
			tools: { node: 'node' },
		}), {}), 'node ${runFile}');
	});

	it('uses configured project runtimes before TypeScript runners', () => {
		assert.equal(resolveRunCommand(target({
			hasDenoConfig: true,
			tools: { deno: 'deno', tsx: 'tsx', node: 'node' },
		}), {}), 'deno run ${runFile}');

		assert.equal(resolveRunCommand(target({
			hasBunLock: true,
			tools: { bun: 'bun', tsx: 'tsx', node: 'node' },
		}), {}), 'bun ${runFile}');
	});

	it('falls back from tsx to ts-node to node for TypeScript files', () => {
		assert.equal(resolveRunCommand(target({
			tools: { 'ts-node': 'ts-node', node: 'node' },
		}), {}), 'ts-node ${runFile}');

		assert.equal(resolveRunCommand(target({
			tools: { node: 'node' },
		}), {}), 'node ${runFile}');
	});

	it('does not run tsx files with native Node', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/App.tsx',
			tools: { node: 'node' },
		}), {}), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/App.tsx',
			tools: { tsx: 'tsx', node: 'node' },
		}), {}), 'tsx ${runFile}');
	});

	it('prefers exact custom commands before extension defaults', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/vitest.config.ts',
			languageId: 'typescript',
			tools: { tsx: 'tsx' },
		}), {
			'.ts': 'tsx --watch ${file}',
			'vitest.config.ts': 'vitest --config ${file}',
		}), 'vitest --config ${file}');
	});

	it('falls back from extension commands to language commands to default commands', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/component.jsx',
			languageId: 'javascriptreact',
		}), {
			javascriptreact: 'vite --host',
		}), 'vite --host');

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/component.jsx',
			languageId: 'javascriptreact',
		}), {
			'.jsx': 'tsx ${file}',
			javascriptreact: 'vite --host',
			default: 'open ${file}',
		}), 'tsx ${file}');

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/component.jsx',
			languageId: 'javascriptreact',
		}), {
			default: 'open ${file}',
		}), 'open ${file}');
	});

	it('normalizes custom command keys and ignores empty commands', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/App.TS',
			languageId: 'typescript',
			tools: { tsx: 'tsx' },
		}), {
			' .TS ': '   ',
			typescript: 'tsx --no-cache ${file}',
		}), 'tsx --no-cache ${file}');
	});

	it('ignores malformed custom command values', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/app.ts',
			tools: { tsx: 'tsx' },
		}), {
			'.ts': 123,
			typescript: 'tsx ${file}',
		} as unknown as RunCommandMap), 'tsx ${runFile}');
	});

	it('supports common extension key forms in custom commands', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/app.ts',
		}), {
			'*.ts': 'tsx ${file}',
		}), 'tsx ${file}');

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/app.py',
		}), {
			py: 'uv run ${file}',
		}), 'uv run ${file}');
	});

	it('supports folder and default custom commands', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src',
			isDirectory: true,
		}), {
			folder: 'npm test',
		}), 'npm test');

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/file.unknown',
		}), {
			default: 'code ${file}',
		}), 'code ${file}');
	});

	it('can disable built-in defaults while keeping custom commands', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/index.ts',
			tools: { tsx: 'tsx' },
		}), {}, false), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src/index.ts',
		}), {
			'.ts': 'custom ${file}',
		}, false), 'custom ${file}');
	});

	it('uses detected tools for popular single-file languages', () => {
		const cases = [
			['/workspace/main.go', { go: 'go' }, 'go run ${runFile}'],
			['/workspace/Main.java', { java: 'java' }, 'java ${runFile}'],
			['/workspace/script.kts', { kotlinc: 'kotlinc' }, 'kotlinc -script ${runFile}'],
			['/workspace/script.lua', { lua: 'lua' }, 'lua ${runFile}'],
			['/workspace/script.php', { php: 'php' }, 'php ${runFile}'],
			['/workspace/script.pl', { perl: 'perl' }, 'perl ${runFile}'],
			['/workspace/script.r', { Rscript: 'Rscript' }, 'Rscript ${runFile}'],
			['/workspace/script.rb', { ruby: 'ruby' }, 'ruby ${runFile}'],
			['/workspace/script.swift', { swift: 'swift' }, 'swift ${runFile}'],
		] as const;

		for (const [fileSystemPath, tools, command] of cases) {
			assert.equal(resolveRunCommand(target({ fileSystemPath, tools }), {}), command);
		}
	});

	it('avoids ambiguous .m defaults unless the language is MATLAB or Octave', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/source.m',
			languageId: 'objective-c',
			tools: { octave: 'octave' },
		}), {}), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/source.m',
			languageId: 'matlab',
			tools: { octave: 'octave' },
		}), {}), 'octave ${runFile}');
	});

	it('handles shell and Windows script defaults', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/script.sh',
			tools: { bash: 'bash' },
		}), {}), 'bash ${runFile}');

		assert.equal(resolveRunCommand(target({
			fileSystemPath: 'C:\\workspace\\script.cmd',
			isPowerShell: true,
			isWindowsTerminal: true,
			tools: { cmd: 'cmd' },
		}), {}), 'cmd /c ${runFile}');

		assert.equal(resolveRunCommand(target({
			fileSystemPath: 'C:\\workspace\\script.cmd',
			isPowerShell: false,
			isWindowsTerminal: true,
			tools: { cmd: 'cmd' },
		}), {}), '${runFile}');
	});

	it('does not invent commands for unsupported files or missing runtimes', () => {
		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/src',
			isDirectory: true,
		}), {}), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/main.go',
		}), {}), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/script.py',
		}), {}), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/script.sh',
		}), {}), undefined);

		assert.equal(resolveRunCommand(target({
			fileSystemPath: '/workspace/file.unknown',
		}), {}), undefined);
	});
});
