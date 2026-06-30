let currentPath;
let dynamicRootTypes;
let componentMaps = [];

let traitPathFieldMaps;
let registeredTraitPathMaps = [];
let traitPathMapNamesByField = {};

let registeredDynamicTraitMaps = [];
let dynamicTraitMapNamesByKey = {};

//Whole-app discovery of FUNCTIONAL traits referenced dynamically (token / array / data-fed sites),
// used to emit per-file direct-import maps in place of the old global resolveDynamicTrait registry.
let dynamicTraitFieldCandidates = new Map();
let dynamicTraitFlatCandidates = [];
let dynamicTraitNonNarrowableFields = new Set();

export const initDynamicRootTypes = ({
	currentPath: _currentPath,
	dynamicRootTypes: _dynamicRootTypes
}) => {
	currentPath = _currentPath;
	dynamicRootTypes = _dynamicRootTypes ?? new Map();
	componentMaps = [];
	registeredTraitPathMaps = [];
	traitPathMapNamesByField = {};
	registeredDynamicTraitMaps = [];
	dynamicTraitMapNamesByKey = {};
};

export const getDynamicRootTypeInfo = type => {
	const dynamicRootType = dynamicRootTypes.get(currentPath);

	if (!dynamicRootType || dynamicRootType.token !== type)
		return;

	return dynamicRootType;
};

export const registerDynamicRootTypeComponentMap = values => {
	const name = `dynamicRootTypeComponents${componentMaps.length + 1}`;

	componentMaps.push({
		name,
		values
	});

	return name;
};

export const getDynamicRootTypeComponentMaps = () => componentMaps;

//Discovered (whole-app) `fieldName -> [{ value, path }]` set for data-token trait references.
// Initialised once for the whole run; read per-file when emitting conditional root types.
export const initTraitPathFieldMaps = _traitPathFieldMaps => {
	traitPathFieldMaps = _traitPathFieldMaps ?? new Map();
};

export const getTraitPathFieldEntries = fieldName => {
	if (!traitPathFieldMaps)
		return [];

	return traitPathFieldMaps.get(fieldName) ?? [];
};

//Register a path-keyed component map (value-string -> imported component identifier) for a field.
// Reuses one map name per field within a file so repeated uses share the same emitted constant.
export const registerTraitPathComponentMap = (fieldName, entries) => {
	if (traitPathMapNamesByField[fieldName])
		return traitPathMapNamesByField[fieldName];

	const name = `${fieldName}Components`;

	traitPathMapNamesByField[fieldName] = name;

	registeredTraitPathMaps.push({
		name,
		entries
	});

	return name;
};

export const getTraitPathComponentMaps = () => registeredTraitPathMaps;

//Register a path-keyed FUNCTIONAL-trait map for a dynamic trait site. Unlike the component maps above,
// these are emitted with lazy thunk values (see generateImports): the imported trait binding is only
// touched when the trait is applied, not at module-init time. That avoids a temporal-dead-zone
// ReferenceError when a file's map references a trait whose module is part of an import cycle back to
// this file (the map literal would otherwise read a not-yet-initialised import during load).
export const registerDynamicTraitMap = (key, entries) => {
	if (dynamicTraitMapNamesByKey[key])
		return dynamicTraitMapNamesByKey[key];

	const name = `dynamicTraitMap_${key}`;

	dynamicTraitMapNamesByKey[key] = name;

	registeredDynamicTraitMaps.push({
		name,
		entries
	});

	return name;
};

export const getDynamicTraitMaps = () => registeredDynamicTraitMaps;

//Discovered (whole-app) functional-trait candidates for dynamic trait sites. Initialised once per run.
export const initDynamicTraitCandidates = ({ fieldCandidates, flatCandidates, nonNarrowableFields } = {}) => {
	dynamicTraitFieldCandidates = fieldCandidates ?? new Map();
	dynamicTraitFlatCandidates = flatCandidates ?? [];
	dynamicTraitNonNarrowableFields = nonNarrowableFields ?? new Set();
};

export const getDynamicTraitFieldCandidates = field => dynamicTraitFieldCandidates.get(field) ?? [];

export const getDynamicTraitFlatCandidates = () => dynamicTraitFlatCandidates;

//A field-keyed dynamic-trait site may use a field-scoped candidate subset ONLY if the field is
// narrowable — i.e. every value it can hold was statically discovered (literal trait paths plus any
// theme-resolved defaults). A field is reported narrowable only when it (a) was NOT flagged as carrying
// an unknown runtime value and (b) is actually a known field (has discovered candidates). A field with
// candidates but no token/opaque default is the narrowable case; a field with zero candidates is left
// to the caller to decide (an array site with only object elements is safe with an empty map).
export const getDynamicTraitFieldNarrowable = field =>
	!dynamicTraitNonNarrowableFields.has(field);
