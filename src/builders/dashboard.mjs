//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Getters / Setters
import { setIsTrait, getIsTrait } from './dashboard/isTrait.mjs';
import { resetTraitImports } from './dashboard/traitImports.mjs';
import { resetScriptImports } from './dashboard/scriptImports.mjs';
import { setIsFunctionalTrait, getIsFunctionalTrait } from './dashboard/isFunctionalTrait.mjs';
import { resetUsedComponentTypes } from './dashboard/usedComponentTypes.mjs';

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

	if (getIsTrait()) {
		// Replace exact full-string "%key%" values inside JSX/object strings
		// Example: id="%id%" -> id={traitPrps.id}
		// Only matches when the entire string is exactly "%key%"
		Object.keys(contents.acceptPrps).forEach(k => {
			rootComponent = rootComponent
				.replaceAll(`'%${k}%'`, `{traitPrps.${k}}`)
				.replaceAll(`"%${k}%"`, `traitPrps.${k}`)
				.replaceAll(`"$${k}$"`, `traitPrps.${k}`)
				.replaceAll(`"%${k}%"`, `\`traitPrps.${k}\``);
		});

		// Replace any object-style prop values (key: "...") containing %...% tokens
		// Example: cpt: "Hello %name%" -> cpt: `Hello ${getDeepProperty(traitPrps, 'name')}`
		// Handles partial strings, multiple tokens, and nested paths like %a.b.c%
		rootComponent = rootComponent.replace(
			/:\s*(["'])([^"']*%[^"']+%[^"']*)\1/g,
			(match, quote, value) => {
				const interpolated = value
					.replaceAll('`', '\\`')
					.replace(/%([A-Za-z0-9][^%]*[A-Za-z0-9])%/g, (_, token) => {
						return `\${getDeepProperty(traitPrps, '${token}')}`;
					});

				return `: \`${interpolated}\``;
			}
		);

		// Replace any object-style prop values (key: "...") containing $...$ tokens
		// Example: cpt: "Hello $name$" -> cpt: `Hello ${getDeepProperty(traitPrps, 'name')}`
		// Same as %...% but for $ tokens, with escaping to prevent premature interpolation
		rootComponent = rootComponent.replace(
			/:\s*(["'])([^"']*\$[^"']+\$[^"']*)\1/g,
			(match, quote, value) => {
				const interpolated = value
					.replaceAll('`', '\\`')
					.replaceAll('${', '\\${')
					.replace(/\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$/g, (_, token) => {
						return `\${getDeepProperty(traitPrps, '${token}')}`;
					});

				return `: \`${interpolated}\``;
			}
		);

		// Replace any JSX attribute value containing %...% tokens
		// Example: id="%id%-suffix" -> id={`${getDeepProperty(traitPrps, 'id')}-suffix`}
		rootComponent = rootComponent.replace(
			/=\s*(["'])([^"']*%[^"']+%[^"']*)\1/g,
			(match, quote, value) => {
				const interpolated = value
					.replaceAll('`', '\\`')
					.replace(/%([A-Za-z0-9][^%]*[A-Za-z0-9])%/g, (_, token) => {
						return `\${getDeepProperty(traitPrps, '${token}')}`;
					});

				return `={\`${interpolated}\`}`;
			}
		);

		// Replace any JSX attribute value containing $...$ tokens
		// Example: id="$id$-suffix" -> id={`${getDeepProperty(traitPrps, 'id')}-suffix`}
		rootComponent = rootComponent.replace(
			/=\s*(["'])([^"']*\$[^"']+\$[^"']*)\1/g,
			(match, quote, value) => {
				const interpolated = value
					.replaceAll('`', '\\`')
					.replaceAll('${', '\\${')
					.replace(/\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$/g, (_, token) => {
						return `\${getDeepProperty(traitPrps, '${token}')}`;
					});

				return `={\`${interpolated}\`}`;
			}
		);
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
