import { outputFolder } from '../config.mjs';
//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Getters / Setters
import { setOriginalFile } from './dashboard/originalFile.mjs';
import { setIsTrait, getIsTrait } from './dashboard/isTrait.mjs';
import { resetTraitImports } from './dashboard/traitImports.mjs';
import { resetScriptImports } from './dashboard/scriptImports.mjs';
import { resetUsedComponentTypes } from './dashboard/usedComponentTypes.mjs';
import { initDynamicRootTypes } from './dashboard/dynamicRootTypes.mjs';
import { setIsFunctionalTrait, getIsFunctionalTrait } from './dashboard/isFunctionalTrait.mjs';

//Helpers
import templates from './dashboard/templates.mjs';
import { initMapFiles } from './dashboard/mapFiles.mjs';
import normalizeTraits from './dashboard/normalizeTraits.mjs';
import buildSpreadTrait from './dashboard/buildSpreadTrait.mjs';
import generateComponent from './dashboard/generateComponent.mjs';
import generatePrefix from './dashboard/generatePrefix.mjs';
import identifyMainTrait from './dashboard/identifyMainTrait.mjs';
import generateTraitOnMount from './dashboard/generateTraitOnMount.mjs';
import generateImports, { initGenerateImports } from './dashboard/generateImports.mjs';

const buildFunctionalTraitDefaults = acceptPrps => {
	return Object.fromEntries(
		Object.entries(acceptPrps ?? {})
			.filter(([, spec]) => spec && Object.prototype.hasOwnProperty.call(spec, 'dft'))
			.map(([key, spec]) => [key, spec.dft])
	);
};

//Export
const dashboard = ({ path, contents }, mapFiles, dynamicRootTypes) => {
	//if (path.includes('actionButtonsFireScript') && path.includes('sboGroupCode')) {
	if (contents.traitArray) {
		buildSpreadTrait({
			path,
			contents
		});

		return;
	}

	initMapFiles(mapFiles);
	initGenerateImports({ currentPath: path });
	initDynamicRootTypes({ currentPath: path, dynamicRootTypes });

	normalizeTraits(contents);

	setOriginalFile(contents, path);

	const hasMainTrait = !!identifyMainTrait(contents.traits);

	setIsTrait(contents.acceptPrps !== undefined);
	setIsFunctionalTrait(getIsTrait() && !contents.type && !hasMainTrait);

	const pathTranspiled = path.replace('.json', '.jsx');

	const outputPath = join(outputFolder, 'src', pathTranspiled);

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
			usePrefix = templates.functionPrefixFunctionalTrait.replace(
				'__FUNCTIONAL_TRAIT_DEFAULTS__',
				JSON.stringify(buildFunctionalTraitDefaults(contents.acceptPrps))
			);
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
		onMountMethod = generateTraitOnMount(contents, path);
	}

	const output = `
		${onMountMethod}

		${generateImports()}

		${usePrefix}
		${rootComponent}
		${useSuffix}
	`;

	const transpiled = `
		${generatePrefix(useMainPrefix, output)}

		${output}
	`;

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default dashboard;
