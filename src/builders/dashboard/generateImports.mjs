//Getters / Setters
import { getUsedComponentTypes } from './usedComponentTypes.mjs';
import { getScriptImports } from './scriptImports.mjs';
import { getTraitImports } from './traitImports.mjs';

//Helpers
import findComponentLibraryName from './findComponentLibraryName.mjs';

//Internal

//Helpers
let currentPath;
let needsHelpers = false;

const getRelativeImportPath = (currentPath, targetPath) => {
	const currentParts = currentPath.split('/');
	const targetParts = targetPath.split('/');

	// Remove filename from current path (index.json)
	currentParts.pop();

	// Find common prefix length
	let i = 0;
	while (i < currentParts.length &&
           i < targetParts.length &&
           currentParts[i] === targetParts[i])
		i++;

	// How many levels to go up
	const ups = currentParts.length - i;
	const upStr = '../'.repeat(ups);

	// Remaining part of target
	const remaining = targetParts.slice(i).join('/');

	return (ups === 0 ? './' : upStr) + remaining;
};

export const initGenerateImports = ({ currentPath: _currentPath }) => {
	currentPath = _currentPath;
	needsHelpers = false;
};

export const setNeedsHelpers = _needsHelpers => {
	needsHelpers = _needsHelpers;
};

const generateImports = () => {
	const trackedImports = {};

	getUsedComponentTypes().forEach(type => {
		const componentLibrary = findComponentLibraryName(type);

		if (!trackedImports[componentLibrary])
			trackedImports[componentLibrary] = [type];
		else
			trackedImports[componentLibrary].push(type);
	});

	const res = [
		...Object.entries(trackedImports)
			.map(([k, v]) => {
				const componentTypes = v.map(type => type[0].toUpperCase() + type.substring(1));

				return `import { ${componentTypes.join(', ')} } from '${k}';`;
			}),
		'\n\n',
		...[...getTraitImports(), ...getScriptImports()]
			.map(({ type, path }) => {
				const relativePath = getRelativeImportPath(currentPath, path);

				return `import ${type} from '${relativePath}';`;
			})
			.flat()
	];

	if (needsHelpers) {
		const relativePath = getRelativeImportPath(currentPath, 'helpers');

		res.push(`import { applyTraits } from '${relativePath}';`);
	}

	return res.join('');
};

export default generateImports;
