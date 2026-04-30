const normalizeTraits = (obj, isInTraitsArray = false, isRoot = true) => {
	if (typeof(obj) !== 'object' || obj === null)
		return;

	//For root objects that include %...% or $...$ somewhere, add acceptPrps if not present
	//This is hacky but we do need to figure out if the file has a missing acceptPrps
	if (isRoot && !obj.acceptPrps) {
		const raw = JSON.stringify(obj);
		const hasToken = /(%[A-Za-z0-9.-]+%|\$[A-Za-z0-9.-]+\$)/.test(raw);

		if (hasToken || !obj.type && !obj.traits)
			obj.acceptPrps = {};
	}

	if (!isInTraitsArray && obj.trait) {
		//If the component had a blueprint and traits before (blueprint would have been changed to trait)
		// we need to ensure we don't throw the old traits away

		if (!obj.traits)
			obj.traits = [];

		obj.traits.push({
			trait: obj.trait,
			traitPrps: obj.traitPrps,
			wasBlueprint: obj.wasBlueprint
		});

		delete obj.trait;
		delete obj.traitPrps;
		delete obj.wasBlueprint;
	}

	if (!isInTraitsArray && obj.blueprint) {
		if (!obj.traits)
			obj.traits = [];

		obj.traits.push({
			trait: obj.blueprint,
			traitPrps: obj.blueprintPrps,
			wasBlueprint: obj.wasBlueprint
		});

		delete obj.blueprint;
		delete obj.blueprintPrps;
		delete obj.wasBlueprint;
	}

	Object.entries(obj).forEach(([k, v]) => {
		if (Array.isArray(v)) {
			v.forEach(item => normalizeTraits(item, k === 'traits', false));

			return;
		}

		if (typeof(v) === 'object' && v !== null)
			normalizeTraits(v, false, false);
	});
};

export default normalizeTraits;
