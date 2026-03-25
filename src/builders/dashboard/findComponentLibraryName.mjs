//Imports
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const findComponentLibraryName = componentType => {
	const baseDir = join(process.cwd(), 'node_modules', '@intenda');

	let packages;
	try {
		packages = readdirSync(baseDir, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => d.name);
	} catch {
		console.error('❌ Could not read @intenda directory');

		return null;
	}

	//Move "opus-ui" to the end if it exists because if it DOES contain the type, it should only be
	// used if no other component library provides it
	packages = packages.sort((a, b) => (a === 'opus-ui' ? 1 : b === 'opus-ui' ? -1 : 0));

	for (const pkg of packages) {
		const componentPath = join(baseDir, pkg, 'dist', 'components', componentType);
		if (existsSync(componentPath))
			return `@intenda/${pkg}`;
	}

	return null;
};

export default findComponentLibraryName;
