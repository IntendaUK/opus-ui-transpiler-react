import { getMapFilesEntry } from './mapFiles.mjs';
import identifyMainTrait from './identifyMainTrait.mjs';
import { getTraitImports, pushToTraitImports } from './traitImports.mjs';
import generateComponent from './generateComponent.mjs';

const refMap = {};

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
const buildTraitsInfo = ({ traits }) => {
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
		const stringifiedContents = JSON.stringify(contents);

		Object.entries(traitPrps).forEach(([k, v]) => {
			if (stringifiedContents.includes(`"wgts":"$${k}$"`) && v.map)
				traitPrps[k] = `<>${v.map(m => generateComponent(m, false, v.length === 1)).join('')}</>`;
		});

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
