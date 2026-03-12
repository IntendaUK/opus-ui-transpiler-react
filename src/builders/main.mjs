//Imports
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

//Config
import { sourceApplicationFolder } from '../config.mjs';

//Templates
const template = `
	import Startup from './$PATH_TO_INDEX$';
	import { createRoot } from 'react-dom/client';

	import '@intenda/opus-ui-repeater-grid';
	import '@intenda/opus-ui-components';
	import '@intenda/opus-ui-drag-move';
	import '@intenda/opus-ui-grid';

	$THEME_IMPORTS$

	//Opus
	import Opus from '@intenda/opus-ui';

	//Plugins
	import '@intenda/vite-plugin-opus-hot-reload/src/hotReload';

	//Styles
	import './transpiled.css';

	const env = import.meta.env.VITE_APP_MODE;

	const themesConfig = $THEMES_CONFIG$;

	const res = await fetch('/app.json')
	const mdaPackage = await res.json();

	const root = createRoot(document.getElementById('root'));
	root.render(
		<Opus
			mdaPackage={mdaPackage}
			options={{ env }}
			startupComponent={<Startup />}
			themesConfig={themesConfig}
			windowHelpers={{
				include: ['spliceWhere']
			}}
		/>
	);
`;

//Helpers
const shouldUseOriginalMain = originalMain => {
	return originalMain.includes('loadApp({');
};

const templatifyOriginalMain = originalMain => {
	let result = originalMain;

	// 1. Remove the line that does an await fetch of a .json file
	result = result.replace(
		/^[ \t]*const\s+\w+\s*=\s*await\s+fetch\(\s*['"][^'"]+\.json['"]\s*\);?[ \t]*\r?\n/m,
		''
	);

	// 2. Remove the line that does await something.json()
	//    and capture the variable name, e.g. const mdaPackage = await res.json();
	let mdaPackageVar = null;
	result = result.replace(
		/^[ \t]*const\s+(\w+)\s*=\s*await\s+\w+\.json\(\s*\);?[ \t]*\r?\n/m,
		(match, varName) => {
			mdaPackageVar = varName;

			return '';
		}
	);

	// 3. Remove the line that looks like `${mdaPackageVar},`
	if (mdaPackageVar) {
		const escapedVar = mdaPackageVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		result = result.replace(
			new RegExp(`^[ \\t]*${escapedVar},[ \\t]*\\r?\\n`, 'm'),
			''
		);
	}

	// 4. Replace import './main.css';
	result = result.replace(
		/^[ \t]*import\s+['"]\.\/main\.css['"];?[ \t]*\r?\n/m,
		'import \'./transpiled.css\';'
	);

	// 5. Inject $THEME_IMPORTS$ right after the last import
	const importMatches = [...result.matchAll(/^[ \t]*import .+;[ \t]*$/gm)];
	if (importMatches.length) {
		const lastImport = importMatches[importMatches.length - 1];
		const insertIndex = lastImport.index + lastImport[0].length;

		result =
			result.slice(0, insertIndex) +
			'\n$THEME_IMPORTS$' +
			result.slice(insertIndex);
	}

	// 6. If createRoot doesn't exist anywhere in the file, inject at the top:
	//    import { createRoot } from 'react-dom/client';
	if (!/\bcreateRoot\b/.test(result))
		result = `import { createRoot } from 'react-dom/client';\n${result}`;

	// 7. Inject at the top: import Startup from './$PATH_TO_INDEX$';
	result = `import Startup from './$PATH_TO_INDEX$';\n${result}`;

	// 8. Inject at the top: import Opus from '@intenda/opus-ui';
	result = `import Opus from '@intenda/opus-ui';\n${result}`;

	// 9. Replace the entire loadApp({ ... }); block
	result = result.replace(
		/^[ \t]*loadApp\(\s*\{[\s\S]*?^[ \t]*\}\);/m,
		`const themesConfig = $THEMES_CONFIG$;

		const res = await fetch('/app.json')
		const mdaPackage = await res.json();

		const root = createRoot(document.getElementById('root'));
		root.render(
			<Opus
				mdaPackage={mdaPackage}
				options={{ env }}
				startupComponent={<Startup />}
				themesConfig={themesConfig}
				windowHelpers={{
					include: ['spliceWhere']
				}}
			/>
		);`
	);

	// 10. Inject meta env variable above the createRoot line if needed
	if (!/\bimport\.meta\.env\b/.test(result)) {
		result = result.replace(
			/^[ \t]*const root = createRoot/m,
			'const env = import.meta.env.VITE_APP_MODE;\n\nconst root = createRoot'
		);
	}

	return result;
};
//Builder
const buildMain = ({ startupPath, themeNames }) => {
	const pathMain = resolve(sourceApplicationFolder, 'src', 'main.jsx');
	const originalMain = readFileSync(pathMain, 'utf8');

	let useTemplate = template;
	if (shouldUseOriginalMain(originalMain))
		useTemplate = templatifyOriginalMain(originalMain);

	const outputPath = join('output', 'src', 'main.jsx');

	mkdirSync(dirname(outputPath), { recursive: true });

	const themeImports = themeNames
		.map(t => `import theme_${t} from './themes/${t}';`)
		.join('');

	const themesConfig = `
		{
			themes: {
				${themeNames.map(t => `${t}: theme_${t}`).join(',')}
			}
		}
	`;

	const transpiled = useTemplate
		.replace('$PATH_TO_INDEX$', `dashboard/${startupPath}`)
		.replace('$THEME_IMPORTS$', themeImports)
		.replace('$THEMES_CONFIG$', themesConfig);

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default buildMain;
