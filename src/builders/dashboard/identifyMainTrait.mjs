import { getMapFilesEntry } from './mapFiles.mjs';
import normalizeTraits from './normalizeTraits.mjs';

//A trait is "type bearing" (a visual component) when its blueprint declares a type,
// or resolves to one through its own nested traits.
const isTypeBearingTrait = f => {
	const traitPath = `dashboard/${f.trait ?? f}.json`;
	const trait = getMapFilesEntry(traitPath);
	normalizeTraits(trait);

	if (!trait)
		return false;

	const { contents: { type: innerType, traits: innerTraits } } = trait;

	if (innerType)
		return true;

	if (innerTraits)
		return !!identifyMainTrait(trait.contents.traits);

	return false;
};

const identifyMainTrait = traits => {
	if (!traits || typeof(traits) === 'string')
		return;

	const typeBearingTraits = traits.filter(isTypeBearingTrait);

	//When two or more visual traits are each guarded by a condition, the traits array is
	// a conditional component selector (e.g. menuSection when a row has children, menuItem
	// otherwise) rather than "one main component + functional add-ons". None of them is THE
	// unconditional main trait, so we report no main trait and let the caller render them as
	// per-row alternatives.
	const conditionedTypeBearingTraits = typeBearingTraits
		.filter(f => typeof(f) === 'object' && f && f.condition);

	if (conditionedTypeBearingTraits.length > 1)
		return;

	return typeBearingTraits[0];
};

export default identifyMainTrait;
