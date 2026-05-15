//Getters / Setters
import { getUsedComponentTypes } from './usedComponentTypes.mjs';
import { getScriptImports } from './scriptImports.mjs';
import { getTraitImports } from './traitImports.mjs';
import { getDynamicRootTypeComponentMaps } from './dynamicRootTypes.mjs';
import { getMapFilesEntry } from './mapFiles.mjs';

//Helpers
import findComponentLibraryName from './findComponentLibraryName.mjs';

//Internal

//Helpers
let currentPath;
let needsHelpers = false;
let needsDynamicTraitResolver = false;

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

const getTraitImportPath = (currentPath, targetPath) => {
	const relativePath = getRelativeImportPath(currentPath, targetPath);
	const collisionEntry = (
		getMapFilesEntry(targetPath) ??
		getMapFilesEntry(targetPath.replace(/^dashboard\//, ''))
	);

	if (collisionEntry?.type === 'scriptAction')
		return `${relativePath}.jsx`;

	return relativePath;
};

export const initGenerateImports = ({ currentPath: _currentPath }) => {
	currentPath = _currentPath;
	needsHelpers = false;
	needsDynamicTraitResolver = false;
};

export const setNeedsHelpers = _needsHelpers => {
	needsHelpers = _needsHelpers;
};

export const setNeedsDynamicTraitResolver = _needsDynamicTraitResolver => {
	needsDynamicTraitResolver = _needsDynamicTraitResolver;
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
		...getTraitImports()
			.map(({ type, path }) => {
				const relativePath = getTraitImportPath(currentPath, path);

				return `import ${type} from '${relativePath}';`;
			})
			.flat(),
		...getScriptImports()
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

	if (needsDynamicTraitResolver) {
		const relativePath = getRelativeImportPath(currentPath, 'dynamicTraits');

		res.push(`import { resolveDynamicTrait } from '${relativePath}';`);
	}

	getDynamicRootTypeComponentMaps().forEach(({ name, values }) => {
		const entries = values
			.map(type => `${JSON.stringify(type)}: ${type[0].toUpperCase() + type.substring(1)}`)
			.join(', ');

		res.push(`const ${name} = { ${entries} };`);
	});

	return res.join('');
};

export default generateImports;
