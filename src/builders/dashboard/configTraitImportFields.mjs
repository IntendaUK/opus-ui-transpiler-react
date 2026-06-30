//Config-trait `traitPrps` fields whose value is a trait-path reference that the consuming (usually
//shared) component invokes as a CONFIG function — e.g. a grid's `traitDataManager`, applied via
//`traitPrps.traitDataManager?.(prps)`. Across the whole app these fields only ever hold a static
//trait path, a forwarding token (`%field%` / `$field$`), or the acceptPrp type declaration — never
//per-row `((...))` data and never a runtime/handler-set string. That makes every value statically
//resolvable, so we convert the literal-path values to DIRECT imports at the use site
//(transformTraitReferences) and suppress the field's whole-app candidate map
//(getDynamicTraitFieldCandidates). The reference then lives with the caller instead of piling every
//app-wide candidate into one huge map inside the shared component.
//
//Component traits convert to `<Import>.traitConfig` (the config closure the consumer calls); functional
//traits convert to the bare `<Import>`. Forwarding tokens are left as accessors and carry whatever
//function the parent's converted use site supplied.
export const CONFIG_TRAIT_IMPORT_FIELDS = new Set([
	'traitDataManager',
	'traitModifiedRecordsManager',
	'traitReorderedRecordsManager'
]);

export default CONFIG_TRAIT_IMPORT_FIELDS;
