//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

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

	const root = createRoot(document.getElementById('root'));
	root.render(
		<Opus options={{ env }}
			startupComponent={<Startup />}
			themesConfig={themesConfig}
			windowHelpers={{
				include: ['spliceWhere']
			}}
		/>
	);
`;

//Builder
const buildMain = ({ startupPath, themeNames }) => {
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

	const transpiled = template
		.replace('$PATH_TO_INDEX$', `dashboard/${startupPath}`)
		//.replace('$PATH_TO_INDEX$', 'dashboard/pocObjectLibrary/index')
		.replace('$THEME_IMPORTS$', themeImports)
		.replace('$THEMES_CONFIG$', themesConfig);

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default buildMain;
