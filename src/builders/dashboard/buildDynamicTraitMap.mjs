import { getTraitImports, pushToTraitImports } from './traitImports.mjs';
import { registerDynamicTraitMap } from './dynamicRootTypes.mjs';

/*
	Emits a per-file map of DIRECT imports for a set of dynamic functional-trait candidates and returns
	the map's local variable name. Each candidate is imported (deduped against the file's existing trait
	imports) and the map is registered so generateImports writes
	`const <name> = { "<value>": (prps) => <Ident>(prps) }`. Callers index it with the runtime
	trait-path value, e.g. `<name>[traitPrps.x]?.(prps)` — replacing the old global
	`resolveDynamicTrait(...)` lookup.

	Values are lazy thunks (not bare identifiers) so the imported binding is read at apply time rather
	than at module load — otherwise a map referencing a trait whose module imports back into this file
	would hit that import's temporal dead zone during load.

	`mapKey` namespaces the map within the file so repeated uses of the same field/site share one map.
*/
const buildDynamicTraitMap = (mapKey, candidates) => {
	candidates.forEach(({ type, path }) => {
		if (!getTraitImports().some(f => f.type === type))
			pushToTraitImports({ type, path });
	});

	return registerDynamicTraitMap(
		mapKey,
		candidates.map(({ value, type, isComponentTrait }) => ({ value, type, isComponentTrait }))
	);
};

export default buildDynamicTraitMap;
