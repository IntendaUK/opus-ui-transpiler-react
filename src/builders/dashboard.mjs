//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Getters / Setters
import { setOriginalFile } from './dashboard/originalFile.mjs';
import { setIsTrait, getIsTrait } from './dashboard/isTrait.mjs';
import { resetTraitImports } from './dashboard/traitImports.mjs';
import { resetScriptImports } from './dashboard/scriptImports.mjs';
import { resetUsedComponentTypes } from './dashboard/usedComponentTypes.mjs';
import { setIsFunctionalTrait, getIsFunctionalTrait } from './dashboard/isFunctionalTrait.mjs';

//Helpers
import templates from './dashboard/templates.mjs';
import { initMapFiles } from './dashboard/mapFiles.mjs';
import normalizeTraits from './dashboard/normalizeTraits.mjs';
import generateComponent from './dashboard/generateComponent.mjs';
import identifyMainTrait from './dashboard/identifyMainTrait.mjs';
import generateTraitOnMount from './dashboard/generateTraitOnMount.mjs';
import generateImports, { initGenerateImports } from './dashboard/generateImports.mjs';

//Export
const dashboard = ({ path, contents }, mapFiles) => {
	initMapFiles(mapFiles);
	initGenerateImports({ currentPath: path });

	normalizeTraits(contents);

	setOriginalFile(contents);

	const hasMainTrait = !!identifyMainTrait(contents.traits);

	setIsTrait(contents.acceptPrps !== undefined);
	setIsFunctionalTrait(getIsTrait() && !contents.type && !hasMainTrait);

	const pathTranspiled = path.replace('.json', '.jsx');

	const outputPath = join('output', 'src', pathTranspiled);

	mkdirSync(dirname(outputPath), { recursive: true });

	resetUsedComponentTypes();
	resetTraitImports();
	resetScriptImports();

	let rootComponent = generateComponent(contents, true, true);

	let usePrefix = templates.functionPrefix;
	let useSuffix = templates.functionSuffix;
	if (getIsTrait()) {
		if (!getIsFunctionalTrait()) {
			usePrefix = templates.functionPrefixHasMainTrait;
			useSuffix = templates.functionSuffixHasMainTrait;
		} else {
			usePrefix = templates.functionPrefixFunctionalTrait;
			useSuffix = templates.functionSuffixFunctionalTrait;
		}
	}

	if (hasMainTrait) {
		usePrefix = templates.functionPrefixHasMainTrait;
		useSuffix = templates.functionSuffixHasMainTrait;
	}

	let onMountMethod = '';

	let useMainPrefix = templates.mainPrefix;
	if ((getIsTrait() || hasMainTrait) && !getIsFunctionalTrait()) {
		if (!contents.acceptPrps)
			contents.acceptPrps = {};

		useMainPrefix = templates.mainPrefixHasMainTrait;
		onMountMethod = generateTraitOnMount(contents);
	}

	const transpiled = `
		${useMainPrefix}

		${onMountMethod}

		${generateImports()}

		${usePrefix}
		${rootComponent}
		${useSuffix}
	`;

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default dashboard;
