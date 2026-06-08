//Imports
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

//Config
import { sourceApplicationFolder } from '../../config.mjs';

//Resolves which installed package provides a given Opus UI component type.
//
// We scan the SOURCE application's node_modules (never the transpiler's own), because the source
// app is what declares and depends on the component libraries the dashboards actually use. A
// package "provides" a component when it exposes a dist/components/<componentType> folder, which is
// how the Opus UI component libraries are built. Both @scope/name and unscoped packages are
// considered, so libraries such as @intenda/opus-ui-drag-move and unscoped ones are both found.
//
// Note: packages that bundle everything into a single lib.js and register their components at
// runtime (e.g. opus-ui-diagram) have no dist/components folder and therefore cannot be resolved to
// a direct import here. Such types resolve through the runtime component registry instead.

let cachedPackages;

const collectComponentPackages = () => {
	const nodeModulesDir = join(sourceApplicationFolder, 'node_modules');

	const packages = [];

	const addIfProvidesComponents = name => {
		const componentsDir = join(nodeModulesDir, name, 'dist', 'components');

		if (existsSync(componentsDir))
			packages.push({ name, componentsDir });
	};

	let entries;
	try {
		entries = readdirSync(nodeModulesDir, { withFileTypes: true });
	} catch {
		console.error(`❌ Could not read source application node_modules at ${nodeModulesDir}`);

		return packages;
	}

	entries.forEach(entry => {
		if (!entry.isDirectory() || entry.name.startsWith('.'))
			return;

		//Scoped packages (@scope/name): descend one level to find the actual packages.
		if (entry.name.startsWith('@')) {
			let scopedEntries;
			try {
				scopedEntries = readdirSync(join(nodeModulesDir, entry.name), { withFileTypes: true });
			} catch {
				return;
			}

			scopedEntries.forEach(scopedEntry => {
				if (scopedEntry.isDirectory())
					addIfProvidesComponents(`${entry.name}/${scopedEntry.name}`);
			});

			return;
		}

		addIfProvidesComponents(entry.name);
	});

	//opus-ui is the base library; only fall back to it when nothing more specific provides the type.
	packages.sort((a, b) => (a.name === '@intenda/opus-ui' ? 1 : b.name === '@intenda/opus-ui' ? -1 : 0));

	return packages;
};

const findComponentLibraryName = componentType => {
	if (!cachedPackages)
		cachedPackages = collectComponentPackages();

	for (const { name, componentsDir } of cachedPackages) {
		if (existsSync(join(componentsDir, componentType)))
			return name;
	}

	return null;
};

export default findComponentLibraryName;
