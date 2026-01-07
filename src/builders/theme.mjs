//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Strings
const themePrefix = 'const Theme =';

const themeSuffix = `
	;

	export default Theme;
`;

//Helpers
const generateTheme = theme => {
	const res = JSON.stringify(theme, null, '\t');

	return res;
};

const theme = ({ path, contents }) => {
	const transpiled = `
		${themePrefix}
		${generateTheme(contents)}
		${themeSuffix}
	`;

	path = path
		.replace('theme/', 'themes/')
		.replace('.json', '.jsx');

	const outputPath = join('output', 'src', path);

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default theme;
