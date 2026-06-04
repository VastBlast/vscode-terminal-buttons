import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it } from 'node:test';
import { RuntimeDetector, getToolCandidates } from '../runtimeTools';
import { getShellContext } from '../shell';

describe('runtime tool detection', () => {
	it('selects only relevant tool candidates for each file type', () => {
		const posix = getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' });
		const powershell = getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'pwsh.exe' });

		assert.deepEqual(getToolCandidates('/workspace/app.ts', posix), ['deno', 'bun', 'tsx', 'ts-node', 'node']);
		assert.deepEqual(getToolCandidates('/workspace/App.tsx', posix), ['deno', 'bun', 'tsx', 'ts-node']);
		assert.deepEqual(getToolCandidates('/workspace/script.py', posix), ['python3', 'python']);
		assert.deepEqual(getToolCandidates('/workspace/source.m', posix, 'objective-c'), []);
		assert.deepEqual(getToolCandidates('/workspace/source.m', posix, 'matlab'), ['octave']);
		assert.deepEqual(getToolCandidates('C:\\workspace\\script.py', powershell), ['python', 'py', 'python3']);
		assert.deepEqual(getToolCandidates('C:\\workspace\\script.cmd', powershell), ['cmd']);
		assert.deepEqual(getToolCandidates('/workspace/main.rs', posix), []);
	});

	it('uses configured command strings and executable paths without PATH probing', async () => {
		const detector = new RuntimeDetector();
		const shellContext = getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'pwsh.exe' });
		const info = await detector.detect({
			autoDetect: false,
			cwd: 'C:\\workspace',
			fileSystemPath: 'C:\\workspace\\app.ts',
			shellContext,
			toolCommands: {
				node: 'node --enable-source-maps',
				tsx: 'C:\\Program Files\\tsx\\tsx.cmd',
			},
		});

		assert.equal(info.tools.node, 'node --enable-source-maps');
		assert.equal(info.tools.tsx, "& 'C:\\Program Files\\tsx\\tsx.cmd'");
	});

	it('ignores malformed configured tool values', async () => {
		const detector = new RuntimeDetector();
		const info = await detector.detect({
			autoDetect: false,
			cwd: '/workspace',
			fileSystemPath: '/workspace/app.ts',
			shellContext: getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' }),
			toolCommands: {
				node: 123,
				tsx: 'tsx',
			} as unknown as Record<string, string>,
		});

		assert.deepEqual(info.tools, { tsx: 'tsx' });
	});

	it('finds project-local TypeScript runners before PATH commands', async () => {
		const root = await makeTempProject();
		try {
			const packageRoot = join(root, 'packages', 'app');
			await mkdir(join(packageRoot, 'node_modules', '.bin'), { recursive: true });
			await mkdir(join(packageRoot, 'src'), { recursive: true });
			await writeFile(join(packageRoot, 'node_modules', '.bin', 'tsx.cmd'), '');

			const detector = new RuntimeDetector();
			const shellContext = getShellContext({ pathStyle: 'native', platform: 'win32', shellPath: 'pwsh.exe' });
			const info = await detector.detect({
				autoDetect: false,
				cwd: join(packageRoot, 'src'),
				fileSystemPath: join(packageRoot, 'src', 'app.ts'),
				shellContext,
				toolCommands: {},
				workspaceFolder: root,
			});

			assert.equal(info.tools.tsx, `& '${join(packageRoot, 'node_modules', '.bin', 'tsx.cmd').replaceAll("'", "''")}'`);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it('skips JavaScript project indicators for unrelated file types', async () => {
		const root = await makeTempProject();
		try {
			await writeFile(join(root, 'bun.lock'), '');
			await writeFile(join(root, 'deno.json'), '{}');

			const detector = new RuntimeDetector();
			const info = await detector.detect({
				autoDetect: false,
				cwd: root,
				fileSystemPath: join(root, 'script.py'),
				shellContext: getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' }),
				toolCommands: {},
				workspaceFolder: root,
			});

			assert.equal(info.hasBunLock, false);
			assert.equal(info.hasDenoConfig, false);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it('does not resolve Deno or Bun tools without matching project indicators', async () => {
		const root = await makeTempProject();
		try {
			const detector = new RuntimeDetector();
			const baseRequest = {
				autoDetect: false,
				cwd: root,
				fileSystemPath: join(root, 'app.ts'),
				shellContext: getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' }),
				toolCommands: {
					bun: 'bun',
					deno: 'deno',
					node: 'node',
				},
				workspaceFolder: root,
			};

			assert.deepEqual((await detector.detect(baseRequest)).tools, { node: 'node' });

			await writeFile(join(root, 'bun.lock'), '');
			assert.deepEqual((await detector.detect(baseRequest)).tools, { bun: 'bun', node: 'node' });

			await writeFile(join(root, 'deno.json'), '{}');
			assert.deepEqual((await detector.detect(baseRequest)).tools, { bun: 'bun', deno: 'deno', node: 'node' });
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it('detects Bun and Deno project indicators without caching stale filesystem state', async () => {
		const root = await makeTempProject();
		try {
			const detector = new RuntimeDetector();
			const shellContext = getShellContext({ pathStyle: 'native', platform: 'linux', shellPath: 'bash' });
			const request = {
				autoDetect: false,
				cwd: root,
				fileSystemPath: join(root, 'app.ts'),
				shellContext,
				toolCommands: {},
				workspaceFolder: root,
			};

			assert.deepEqual(await detector.detect(request), {
				hasBunLock: false,
				hasDenoConfig: false,
				tools: {},
			});

			await writeFile(join(root, 'bun.lock'), '');
			await writeFile(join(root, 'deno.json'), '{}');

			const info = await detector.detect(request);
			assert.equal(info.hasBunLock, true);
			assert.equal(info.hasDenoConfig, true);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it('probes WSL PATH instead of host PATH for local Windows WSL terminals', async () => {
		const calls: Array<{ args: string[]; file: string }> = [];
		const detector = new RuntimeDetector((file, args) => {
			calls.push({ args, file });
			return args.at(-1)?.includes('tsx') ? Promise.resolve() : Promise.reject(new Error('missing'));
		});
		const info = await detector.detect({
			autoDetect: true,
			cwd: 'C:\\workspace',
			fileSystemPath: 'C:\\workspace\\app.ts',
			shellContext: getShellContext({ defaultProfile: 'Ubuntu', pathStyle: 'auto', platform: 'win32' }),
			toolCommands: {},
		});

		assert.equal(info.tools.tsx, 'tsx');
		assert.equal(calls.some(call => call.file === 'where.exe'), false);
		assert.equal(calls.some(call => call.file === 'wsl.exe' && call.args.includes('command -v tsx')), true);
	});

	it('uses the WSL profile distro when available', async () => {
		const calls: Array<{ args: string[]; file: string }> = [];
		const detector = new RuntimeDetector((file, args) => {
			calls.push({ args, file });
			return Promise.reject(new Error('missing'));
		});

		await detector.detect({
			autoDetect: true,
			cwd: 'C:\\workspace',
			fileSystemPath: 'C:\\workspace\\app.ts',
			shellContext: getShellContext({
				defaultProfile: 'Ubuntu-24.04',
				pathStyle: 'auto',
				platform: 'win32',
				profileSource: 'WSL',
			}),
			toolCommands: {},
		});

		assert.equal(calls.some(call => call.file === 'wsl.exe' && call.args.slice(0, 2).join(' ') === '-d Ubuntu-24.04'), true);
	});
});

async function makeTempProject() {
	const root = join(tmpdir(), `terminal-buttons-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(root, { recursive: true });
	return root;
}
