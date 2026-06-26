import { outputFolder } from '../../config.mjs';
//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const buildSpreadTrait = ({ path, contents }) => {
	const pathTranspiled = path.replace('.json', '.jsx');
	const outputPath = join(outputFolder, 'src', pathTranspiled);
	mkdirSync(dirname(outputPath), { recursive: true });

	const transpiled = `
		const spreadTrait = {
			acceptPrps: ${JSON.stringify(contents.acceptPrps)},
			traitArray: ${JSON.stringify(contents.traitArray)}
		};

		export default spreadTrait;
	`;

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default buildSpreadTrait;
