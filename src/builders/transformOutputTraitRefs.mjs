import { outputFolder } from '../config.mjs';
//Imports
import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, relative, extname } from 'path';

//Helpers
import { transformTraitReferences } from './scriptAction.mjs';

//Final pass over the whole generated output: rewrite any remaining trait path string (in MDA built
// anywhere — handlers, local components, and metadata nested under arbitrary keys such as
// tabContents/tOpenTab) into a direct import of the transpiled trait module. This is the catch-all
// that guarantees no trait reference is left to be resolved from JSON at runtime.
// `transformTraitReferences` converts both COMPONENT and FUNCTIONAL traits (spread/blueprint traits
// and data-driven {{...}} references are untouched) and is idempotent, so re-processing already-
// converted files is a no-op.
const transformOutputTraitRefs = mapFiles => {
	if (!mapFiles)
		return;

	const root = join(outputFolder, 'src');

	const walk = dir => {
		readdirSync(dir).forEach(name => {
			const fullPath = join(dir, name);

			if (statSync(fullPath).isDirectory()) {
				walk(fullPath);

				return;
			}

			if (!['.js', '.jsx'].includes(extname(name)))
				return;

			const contents = readFileSync(fullPath, 'utf8');

			//currentPath: file path relative to output/src, forward slashes, no extension.
			const currentPath = relative(root, fullPath).split('\\').join('/').replace(/\.[^.]+$/, '');

			const transformed = transformTraitReferences(contents, currentPath, mapFiles);

			if (transformed !== contents)
				writeFileSync(fullPath, transformed, 'utf8');
		});
	};

	walk(root);
};

export default transformOutputTraitRefs;
