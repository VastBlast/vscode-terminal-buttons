import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getPathParts, getRelativePath } from '../paths';

describe('path helpers', () => {
	it('parses POSIX paths', () => {
		assert.deepEqual(getPathParts('/workspace/src/index.test.ts'), {
			basename: 'index.test.ts',
			basenameNoExtension: 'index.test',
			dirname: '/workspace/src',
			extname: '.ts',
		});
	});

	it('parses Windows paths', () => {
		assert.deepEqual(getPathParts('C:\\workspace\\src\\App.TS'), {
			basename: 'App.TS',
			basenameNoExtension: 'App',
			dirname: 'C:\\workspace\\src',
			extname: '.ts',
		});
	});

	it('handles extensionless files and dotfiles', () => {
		assert.deepEqual(getPathParts('/workspace/Makefile'), {
			basename: 'Makefile',
			basenameNoExtension: 'Makefile',
			dirname: '/workspace',
			extname: '',
		});
		assert.deepEqual(getPathParts('/workspace/.env'), {
			basename: '.env',
			basenameNoExtension: '.env',
			dirname: '/workspace',
			extname: '',
		});
	});

	it('computes relative paths for POSIX and Windows workspaces', () => {
		assert.equal(getRelativePath('/workspace', '/workspace/src/index.ts'), 'src/index.ts');
		assert.equal(getRelativePath('C:\\workspace', 'C:\\workspace\\src\\index.ts'), 'src\\index.ts');
	});
});
