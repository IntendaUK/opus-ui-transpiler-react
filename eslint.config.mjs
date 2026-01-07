// eslint.config.mjs
import js from '@eslint/js';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-plugin-prettier';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
	js.configs.recommended,

	...compat.extends('plugin:react/recommended'),
	...compat.extends('plugin:react-hooks/recommended'),

	{
		files: ['**/*.{js,jsx}'],
		ignores: ['dist', 'output', 'node_modules'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module'
		},
		settings: { react: { version: 'detect' } },
		plugins: {
			react: pluginReact,
			'react-hooks': pluginReactHooks,
			prettier
		},
		rules: {
			// Make code tidy with one formatter
			'prettier/prettier': 'error',

			// Common React modern defaults
			'react/react-in-jsx-scope': 'off', // not needed with new JSX transform
			'react/prop-types': 'off',

			// Keep hooks rules
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn'
		}
	}
];
