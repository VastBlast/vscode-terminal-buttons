import typescriptEslint from 'typescript-eslint';

export default [{
	files: ['src/**/*.ts'],
	plugins: {
		'@typescript-eslint': typescriptEslint.plugin,
	},

	languageOptions: {
		ecmaVersion: 2022,
		parser: typescriptEslint.parser,
		sourceType: 'module',
	},

	rules: {
		'@typescript-eslint/naming-convention': ['error', {
			format: ['camelCase', 'PascalCase'],
			selector: 'import',
		}],

		curly: 'error',
		eqeqeq: 'error',
		'no-throw-literal': 'error',
		semi: 'error',
	},
}];
