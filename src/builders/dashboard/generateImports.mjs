//Getters / Setters
import { getUsedComponentTypes } from './usedComponentTypes.mjs';
import { getScriptImports } from './scriptImports.mjs';
import { getTraitImports } from './traitImports.mjs';
import { getDynamicRootTypeComponentMaps, getTraitPathComponentMaps, getDynamicTraitMaps } from './dynamicRootTypes.mjs';
import { getMapFilesEntry } from './mapFiles.mjs';

//Helpers
import findComponentLibraryName from './findComponentLibraryName.mjs';
import findLocalComponentPath from './findLocalComponentPath.mjs';

//Internal

//Helpers
let currentPath;
let needsHelpers = false;
let needsConditionalRootType = false;
let needsDynamicTypeComponent = false;
let needsRenderWgts = false;
let needsRenderDynamicTraits = false;

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
	needsConditionalRootType = false;
	needsDynamicTypeComponent = false;
	needsRenderWgts = false;
	needsRenderDynamicTraits = false;
};

export const setNeedsHelpers = _needsHelpers => {
	needsHelpers = _needsHelpers;
};

export const setNeedsConditionalRootType = _needsConditionalRootType => {
	needsConditionalRootType = _needsConditionalRootType;
};

export const setNeedsDynamicTypeComponent = _needsDynamicTypeComponent => {
	needsDynamicTypeComponent = _needsDynamicTypeComponent;
};

export const setNeedsRenderWgts = _needsRenderWgts => {
	needsRenderWgts = _needsRenderWgts;
};

export const setNeedsRenderDynamicTraits = _needsRenderDynamicTraits => {
	needsRenderDynamicTraits = _needsRenderDynamicTraits;
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

	//A component whose own `wgts` is a dynamic traitPrps token renders that value through renderWgts,
	// the shared opus-ui helper. It handles both shapes the value can take at runtime: already-transpiled
	// React elements (rendered as-is) or raw Opus MDA built by a script/handler (run through wrapWidgets).
	if (needsRenderWgts)
		res.push("import { renderWgts } from '@intenda/opus-ui';");

	//A typeless grid-cell node whose dynamic trait list (innerTraits / headerTraits) may contain a
	// COMPONENT trait renders through this helper, which picks the component trait as the element type
	// (mirroring the runtime's wrapWidgets.findComponentTraitIndex) instead of merge-calling it.
	if (needsRenderDynamicTraits) {
		const relativePath = getRelativeImportPath(currentPath, 'renderDynamicTraits');

		res.push(`import { renderDynamicTraits } from '${relativePath}';`);
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

	//Path-keyed FUNCTIONAL-trait maps for dynamic trait sites. Values are lazy thunks so the imported
	// trait binding is read when the trait is applied, not during this module's load — preventing a
	// temporal-dead-zone ReferenceError when a referenced trait's module imports back into this file.
	getDynamicTraitMaps().forEach(({ name, entries }) => {
		const mapEntries = entries
			.map(({ value, type, isComponentTrait }) =>
				//A COMPONENT trait used as a CONFIG trait (e.g. a grid's `traitDataManager`) must contribute
				// its CONFIG, not its JSX — so call the module's `.traitConfig(prps)` closure. A functional
				// trait's module IS the config function, so call it directly.
				isComponentTrait
					? `${JSON.stringify(value)}: (prps) => ${type}.traitConfig(prps)`
					: `${JSON.stringify(value)}: (prps) => ${type}(prps)`
			)
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
