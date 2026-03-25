const normalizeTraits = (obj, isInTraitsArray = false) => {
	if (typeof(obj) !== 'object' || obj === null)
		return;

	if (!isInTraitsArray && obj.trait) {
		obj.traits = [{
			trait: obj.trait,
			traitPrps: obj.traitPrps
		}];

		delete obj.trait;
		delete obj.traitPrps;
	}

	if (!isInTraitsArray && obj.blueprint) {
		obj.traits = [{
			trait: obj.blueprint,
			traitPrps: obj.blueprintPrps
		}];

		delete obj.blueprint;
		delete obj.blueprintPrps;
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
