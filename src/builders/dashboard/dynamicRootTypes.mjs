let currentPath;
let dynamicRootTypes;
let componentMaps = [];

export const initDynamicRootTypes = ({
	currentPath: _currentPath,
	dynamicRootTypes: _dynamicRootTypes
}) => {
	currentPath = _currentPath;
	dynamicRootTypes = _dynamicRootTypes ?? new Map();
	componentMaps = [];
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
