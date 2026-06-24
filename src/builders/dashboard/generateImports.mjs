//Getters / Setters
import { getUsedComponentTypes } from './usedComponentTypes.mjs';
import { getScriptImports } from './scriptImports.mjs';
import { getTraitImports } from './traitImports.mjs';
import { getDynamicRootTypeComponentMaps, getTraitPathComponentMaps } from './dynamicRootTypes.mjs';
import { getMapFilesEntry } from './mapFiles.mjs';

//Helpers
import findComponentLibraryName from './findComponentLibraryName.mjs';
import findLocalComponentPath from './findLocalComponentPath.mjs';

//Internal

//Helpers
let currentPath;
let needsHelpers = false;
let needsDynamicTraitResolver = false;
let needsConditionalRootType = false;
let needsDynamicTypeComponent = false;

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
	needsConditionalRootType = false;
	needsDynamicTypeComponent = false;
};

export const setNeedsHelpers = _needsHelpers => {
	needsHelpers = _needsHelpers;
};

export const setNeedsDynamicTraitResolver = _needsDynamicTraitResolver => {
	needsDynamicTraitResolver = _needsDynamicTraitResolver;
};

export const setNeedsConditionalRootType = _needsConditionalRootType => {
	needsConditionalRootType = _needsConditionalRootType;
};

export const setNeedsDynamicTypeComponent = _needsDynamicTypeComponent => {
	needsDynamicTypeComponent = _needsDynamicTypeComponent;
};

const generateImports = () => {
	const trackedImports = {};
	const localComponentTypes = [];

	getUsedComponentTypes().forEach(type => {
		//Local components (the app's own src/components/<type>) take precedence over @intenda
		// library components of the same type, mirroring registerComponentTypes overrides in main.jsx.
		// They are rendered through the Opus UI wrapper by type string (like the library's own
		// components) so the runtime resolves the registered component and supplies its state.
		const localComponentPath = findLocalComponentPath(type);

		if (localComponentPath) {
			localComponentTypes.push(type);

			return;
		}

		const componentLibrary = findComponentLibraryName(type);

		if (!componentLibrary)
			console.warn(`[opus-ui-transpiler] Could not resolve component type "${type}" to an @intenda library or a local components/ folder`);

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
		...(localComponentTypes.length
			? ["import { makeComponentWithChildren } from '@intenda/opus-ui';"]
			: []),
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

	if (needsConditionalRootType) {
		const relativePath = getRelativeImportPath(currentPath, 'conditionalRootType');

		res.push(`import { renderConditionalRootType } from '${relativePath}';`);
	}

	if (needsDynamicTypeComponent) {
		const relativePath = getRelativeImportPath(currentPath, 'dynamicTypeComponent');

		res.push(`import { DynamicTypeComponent } from '${relativePath}';`);
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

	//Path-keyed component maps for data-token conditional root types: keyed by the literal trait-path
	// value stored in the row data (what the runtime token substitutes), valued by the imported component.
	getTraitPathComponentMaps().forEach(({ name, entries }) => {
		const mapEntries = entries
			.map(({ value, type }) => `${JSON.stringify(value)}: ${type}`)
			.join(', ');

		res.push(`const ${name} = { ${mapEntries} };`);
	});

	//Wrap each local component by its registered type string so it renders through the Opus UI
	// Wrapper (which supplies state/handlers) instead of being used as a raw, unwrapped component.
	localComponentTypes.forEach(type => {
		const name = type[0].toUpperCase() + type.substring(1);

		res.push(`const ${name} = makeComponentWithChildren('${type}');`);
	});

	return res.join('');
};

export default generateImports;
