import { getMapFilesEntry } from './mapFiles.mjs';
import identifyMainTrait from './identifyMainTrait.mjs';
import { getTraitImports, pushToTraitImports } from './traitImports.mjs';
import generateComponent from './generateComponent.mjs';
import pathToIdentifier from '../pathToIdentifier.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';
import { extractTraitTokenFieldName } from './analyzeTraitPathFields.mjs';

const refMap = {};

const isDynamicTraitPath = path => path.includes('$') || path.includes('%');

const buildTraitAccessor = trait => {
	const rawTrait = trait.trait ?? trait;
	const token = rawTrait.replaceAll('%', '').replaceAll('$', '');

	return buildTraitPrpsAccessor(token);
};

// A nested metadata-MDA container: its `wgts` are data that the runtime renders from metadata
// (and JSON-serializes), NOT React children of this trait. Examples: popoverMda, tooltipMda,
// dropPlaceholderMda, and `{ mda: { ... } }` wrappers such as a contextMenu's `mda`. Rendering such
// `wgts` as JSX would inject React elements (whose `_owner` fibers are circular) into MDA that the
// runtime later stringifies, crashing the wrapper with "cyclic object value".
const isMetadataMdaKey = key => key === 'mda' || /Mda$/.test(key);

// Recursively checks whether a wgts token like "$key$" is used as the trait's own rendered `wgts`
// (its React children, which become JSX). Descent skips nested metadata-MDA containers (see above):
// a token reached only through one of those is data, not children, and must stay as a plain MDA value.
const hasWgtsTokenAsRenderedChildren = (node, key) => {
	if (!node || typeof node !== 'object')
		return false;

	if (node.wgts === `$${key}$`)
		return true;

	return Object.entries(node).some(([k, v]) => {
		if (isMetadataMdaKey(k))
			return false;

		return hasWgtsTokenAsRenderedChildren(v, key);
	});
};

/*
	Returns {
		mainTrait: {
			type,
			path,
			traitPrps,
			auth
		},
		otherTraits: [{
			type,
			path,
			traitPrps,
			auth
		}],
		combinedTraitPrps,
		serializedTraitPrps
	}
*/
const buildTraitsInfo = ({ traits }, { isInRowMda }) => {
	if (!traits?.length)
		return;

	const res = {
		mainTrait: null,
		otherTraits: null,
		combinedPrps: {}
	};

	if (typeof(traits) === 'string') {
		if (!isDynamicTraitPath(traits))
			return;

		res.otherTraits = [{
			isDynamicArray: true,
			expression: buildTraitAccessor(traits)
		}];

		return res;
	}

	res.mainTrait = identifyMainTrait(traits);

	res.otherTraits = [...traits].filter(f => f !== res.mainTrait);

	const getInfoFromTrait = trait => {
		const path = `dashboard/${trait.trait ?? trait}`;
		if (isDynamicTraitPath(path)) {
			return {
				isDynamic: true,
				expression: buildTraitAccessor(trait),
				//The trait-prop field the runtime path comes from, so the emitted candidate map can be
				// scoped to just that field's statically-discovered options.
				field: extractTraitTokenFieldName(trait.trait ?? trait),
				traitPrps: { ...trait.traitPrps },
				auth: trait.auth,
				condition: trait.condition
			};
		}

		const loadedTrait = getMapFilesEntry(`${path}.json`);

		if (!loadedTrait)
			return;

		const { contents } = loadedTrait;

		const type = pathToIdentifier(path);

		if (!contents.type) {
			if (!refMap[type])
				refMap[type] = 1;
			else
				refMap[type]++;
		}

		if (!getTraitImports().some(f => f.type === type)) {
			pushToTraitImports({
				type,
				path
			});
		}

		const traitPrps = { ...trait.traitPrps };

		//Can't have jsx inside rowMda: { ... }
		if (!isInRowMda) {
			Object.entries(traitPrps).forEach(([k, v]) => {
				if (v?.map && hasWgtsTokenAsRenderedChildren(contents, k))
					traitPrps[k] = `<>${v.map(m => generateComponent(m, false, v.length === 1, { forceJsx: true })).join('')}</>`;
			});
		}

		if (trait.wasBlueprint)
			traitPrps.wasBlueprint = true;

		return {
			type,
			path,
			contents,
			traitPrps,
			auth: trait.auth,
			condition: trait.condition
		};
	};

	if (res.mainTrait)
		res.mainTrait = getInfoFromTrait(res.mainTrait);

	res.otherTraits = res.otherTraits
		.map(t => getInfoFromTrait(t))
		.filter(f => !!f);

	res.otherTraits.forEach(({ contents }) => {
		if (!contents)
			return;

		Object.assign(res.combinedPrps, contents.prps);
	});

	return res;
};

export default buildTraitsInfo;
