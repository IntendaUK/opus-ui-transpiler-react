import { getMapFilesEntry } from './mapFiles.mjs';
import identifyMainTrait from './identifyMainTrait.mjs';
import { getTraitImports, pushToTraitImports } from './traitImports.mjs';
import generateComponent from './generateComponent.mjs';

const refMap = {};

// Recursively checks if a wgts token like "$key$" exists anywhere in the object,
// but explicitly ignores anything inside a `popoverMda` branch.
// As soon as `popoverMda` is encountered, that subtree is skipped entirely.
const hasWgtsTokenOutsidePopover = (node, key) => {
	if (!node || typeof node !== 'object')
		return false;

	if (node.wgts === `$${key}$`)
		return true;

	return Object.entries(node).some(([k, v]) => {
		if (k === 'popoverMda')
			return false;

		return hasWgtsTokenOutsidePopover(v, key);
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

	res.mainTrait = identifyMainTrait(traits);

	res.otherTraits = [...traits].filter(f => f !== res.mainTrait);

	const getInfoFromTrait = trait => {
		const path = `dashboard/${trait.trait ?? trait}`;
		if (path.includes('$') || path.includes('%'))
			return;

		const loadedTrait = getMapFilesEntry(`${path}.json`);

		if (!loadedTrait)
			return;

		const { contents } = loadedTrait;

		const type = path
			.replace('@', '')
			.replace('dashboard/', '')
			.split('/')
			.map((t, i) => t[0].toUpperCase() + t.substring(1))
			.join('');

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
				if (v.map && hasWgtsTokenOutsidePopover(contents, k))
					traitPrps[k] = `<>${v.map(m => generateComponent(m, false, v.length === 1)).join('')}</>`;
			});
		}

		if (trait.wasBlueprint)
			traitPrps.wasBlueprint = true;

		return {
			type,
			path,
			contents,
			traitPrps,
			auth: trait.auth
		};
	};

	if (res.mainTrait)
		res.mainTrait = getInfoFromTrait(res.mainTrait);

	res.otherTraits = res.otherTraits
		.map(t => getInfoFromTrait(t))
		.filter(f => !!f);

	res.otherTraits.forEach(({ contents }) => {
		Object.assign(res.combinedPrps, contents.prps);
	});

	return res;
};

export default buildTraitsInfo;
