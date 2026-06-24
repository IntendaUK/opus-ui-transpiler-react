let currentPath;
let dynamicRootTypes;
let componentMaps = [];

let traitPathFieldMaps;
let registeredTraitPathMaps = [];
let traitPathMapNamesByField = {};

export const initDynamicRootTypes = ({
	currentPath: _currentPath,
	dynamicRootTypes: _dynamicRootTypes
}) => {
	currentPath = _currentPath;
	dynamicRootTypes = _dynamicRootTypes ?? new Map();
	componentMaps = [];
	registeredTraitPathMaps = [];
	traitPathMapNamesByField = {};
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
