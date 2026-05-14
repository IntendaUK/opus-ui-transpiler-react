//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Helpers
import identifyMainTrait from './dashboard/identifyMainTrait.mjs';
import { initMapFiles } from './dashboard/mapFiles.mjs';
import normalizeTraits from './dashboard/normalizeTraits.mjs';
import pathToIdentifier from './pathToIdentifier.mjs';

const isFunctionalTrait = contents => {
	const hadAcceptPrps = !!contents.acceptPrps;

	normalizeTraits(contents);

	return hadAcceptPrps && !contents.traitArray && !contents.type && !identifyMainTrait(contents.traits);
};

const buildDynamicTraits = mapFiles => {
	initMapFiles(mapFiles);

	const entries = [...mapFiles.entries()]
		.filter(([path]) => path.startsWith('dashboard/') && path.endsWith('.json'))
		.filter(([, { contents }]) => isFunctionalTrait(contents))
		.map(([path]) => {
			const importPath = `./${path.replace('.json', '')}`;
			const key = path
				.replace('dashboard/', '')
				.replace('.json', '');

			return {
				key,
				type: pathToIdentifier(path),
				importPath
			};
		});

	const imports = entries
		.map(({ type, importPath }) => `import ${type} from '${importPath}';`)
		.join('\n');

	const registryEntries = entries
		.map(({ key, type }) => `\t'${key}': ${type}`)
		.join(',\n');

	const output = `
${imports}

const dynamicTraits = {
${registryEntries}
};

export const resolveDynamicTrait = path => {
\tif (!path)
\t\treturn;

\tconst normalized = String(path)
\t\t.replace(/^dashboard\\//, '')
\t\t.replace(/\\.json$/, '');

\treturn dynamicTraits[normalized];
};
`;

	const outputPath = join('output', 'src', 'dynamicTraits.jsx');

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, output, 'utf8');
};

export default buildDynamicTraits;
