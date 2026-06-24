//Imports
import { readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

//Config
import { sourceApplicationFolder } from '../../config.mjs';

//Resolves which installed package provides a given Opus UI component type.
//
// We scan the SOURCE application's dependencies (never the transpiler's own), because the source
// app is what declares and depends on the component libraries the dashboards actually use. A
// package "provides" a component when it exposes a dist/components/<componentType> folder, which is
// how the Opus UI component libraries are built. Both @scope/name and unscoped packages are
// considered, so libraries such as @intenda/opus-ui-drag-move and unscoped ones are both found.
//
// To support both layouts the source app can be installed in, we look in every node_modules from
// the source app up through its ancestors (Node's own resolution order):
//   * standalone install  -> deps live in <sourceApp>/node_modules
//   * npm workspace member -> deps are hoisted to an ancestor (e.g. the monorepo root) node_modules
// Nearer node_modules win, so a locally installed copy still takes precedence over a hoisted one.
// Walking strictly up from the source folder never reaches the transpiler's own node_modules (it is
// a sibling, not an ancestor), preserving the "never the transpiler's own" guarantee.
//
// Note: packages that bundle everything into a single lib.js and register their components at
// runtime (e.g. opus-ui-diagram) have no dist/components folder and therefore cannot be resolved to
// a direct import here. Such types resolve through the runtime component registry instead.

let cachedPackages;

//A package entry is usable whether it is a real folder (standalone install) or a symlink
// (workspace hoist/link). Dirent.isDirectory() is false for symlinks, so check both.
const isDirLike = dirent => dirent.isDirectory() || dirent.isSymbolicLink();

//Every node_modules dir from the source app up to the filesystem root, nearest first.
const collectNodeModulesDirs = () => {
	const dirs = [];

	let current = resolve(sourceApplicationFolder);
	while (true) {
		dirs.push(join(current, 'node_modules'));

		const parent = dirname(current);
		if (parent === current)
			break;

		current = parent;
	}

	return dirs;
};

const collectComponentPackages = () => {
	const nodeModulesDirs = collectNodeModulesDirs();

	const packages = [];
	//A package found in a nearer node_modules shadows the same name found higher up.
	const seen = new Set();

	const addIfProvidesComponents = (nodeModulesDir, name) => {
		if (seen.has(name))
			return;

		const componentsDir = join(nodeModulesDir, name, 'dist', 'components');

		if (existsSync(componentsDir)) {
			seen.add(name);
			packages.push({ name, componentsDir });
		}
	};

	const scanNodeModulesDir = nodeModulesDir => {
		let entries;
		try {
			entries = readdirSync(nodeModulesDir, { withFileTypes: true });
		} catch {
			//A missing/unreadable node_modules at this level is expected (e.g. an ancestor with none).
			return;
		}

		entries.forEach(entry => {
			//Workspace setups hoist/link dependencies as symlinks; a Dirent for a symlink reports
			// isSymbolicLink() (not isDirectory()), so we must accept both to find linked packages.
			if (!isDirLike(entry) || entry.name.startsWith('.'))
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
					if (isDirLike(scopedEntry))
						addIfProvidesComponents(nodeModulesDir, `${entry.name}/${scopedEntry.name}`);
				});

				return;
			}

			addIfProvidesComponents(nodeModulesDir, entry.name);
		});
	};

	//Nearest first, so locally installed libraries shadow hoisted ones.
	nodeModulesDirs.forEach(scanNodeModulesDir);

	if (packages.length === 0)
		console.error(`❌ Could not find any Opus UI component libraries in node_modules near ${resolve(sourceApplicationFolder)}`);

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
