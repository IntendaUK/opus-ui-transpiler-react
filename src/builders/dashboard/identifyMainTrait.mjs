import { getMapFilesEntry } from './mapFiles.mjs';

const identifyMainTrait = traits => {
	if (!traits || typeof(traits) === 'string')
		return;

	let res;

	traits.forEach(f => {
		if (res)
			return;

		const traitPath = `dashboard/${f.trait ?? f}.json`;
		const trait = getMapFilesEntry(traitPath);

		if (!trait)
			return;

		const { contents: { type: innerType, traits: innerTraits } } = trait;

		if (innerType)
			res = f;
		else if (innerTraits) {
			const innerRes = identifyMainTrait(trait.contents.traits);

			if (innerRes)
				res = f;
		}
	});

	return res;
};

export default identifyMainTrait;
