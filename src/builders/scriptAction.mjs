//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Helpers
const scriptAction = ({ path, contents }) => {
	const transpiled = contents;

	const outputPath = join('output', 'src', 'dashboard', path) + '.js';

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default scriptAction;
