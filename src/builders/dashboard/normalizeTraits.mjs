const normalizeTraits = (obj, isInTraitsArray = false) => {
	if (typeof(obj) !== 'object' || obj === null)
		return;

	if (!isInTraitsArray && obj.trait) {
		obj.traits = [{
			trait: obj.trait,
			traitPrps: obj.traitPrps,
			wasBlueprint: obj.wasBlueprint
		}];

		delete obj.trait;
		delete obj.traitPrps;
		delete obj.wasBlueprint;
	}

	if (!isInTraitsArray && obj.blueprint) {
		obj.traits = [{
			trait: obj.blueprint,
			traitPrps: obj.blueprintPrps,
			wasBlueprint: obj.wasBlueprint
		}];

		delete obj.blueprint;
		delete obj.blueprintPrps;
		delete obj.wasBlueprint;
	}

	Object.entries(obj).forEach(([k, v]) => {
		if (Array.isArray(v)) {
			v.forEach(item => normalizeTraits(item, k === 'traits'));

			return;
		}

		if (typeof(v) === 'object' && v !== null)
			normalizeTraits(v, false);
	});
};

export default normalizeTraits;
