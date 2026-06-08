//Imports
import { existsSync } from 'fs';
import { join } from 'path';

//Returns the map-style path to an app-level component when one exists in the application's own
// src/components/<type> folder. That folder is copied into output/src by the "Loading Custom Code"
// step (buildSrcFoldersAndFiles), which runs before transpiling, so it is present here. These are
// components the app registers itself (via registerComponentTypes in main.jsx) and that the
// transpiler would otherwise be unable to resolve to an @intenda package.
// Returns null when there is no such local component.
const findLocalComponentPath = componentType => {
	const componentDir = join(process.cwd(), 'output', 'src', 'components', componentType);

	if (existsSync(componentDir))
		return `components/${componentType}`;

	return null;
};

export default findLocalComponentPath;
