
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { ESLint } from 'eslint';
import { execSync } from 'child_process';

import { sourceApplicationFolder, targetApplicationFolder, outputFolder, replaceMainJsx, replacePublicFolder, preservedSrcFolders } from './config.mjs';

import buildMain from './builders/main.mjs';
import buildTheme from './builders/theme.mjs';
import buildHelpers from './builders/helpers.mjs';
import buildDashboard from './builders/dashboard.mjs';
import buildScriptAction from './builders/scriptAction.mjs';
import buildSrcFoldersAndFiles from './builders/srcFoldersAndFiles.mjs';
import transformOutputTraitRefs from './builders/transformOutputTraitRefs.mjs';
import analyzeDynamicRootTypes from './builders/dashboard/analyzeDynamicRootTypes.mjs';
import analyzeTraitPathFields from './builders/dashboard/analyzeTraitPathFields.mjs';
import analyzeDynamicTraitCandidates from './builders/dashboard/analyzeDynamicTraitCandidates.mjs';
import { initTraitPathFieldMaps, initDynamicTraitCandidates } from './builders/dashboard/dynamicRootTypes.mjs';
import { initMapFiles } from './builders/dashboard/mapFiles.mjs';

let mdaPackage;
const mapFiles = new Map();
const themeNames = [];
let dynamicRootTypes = new Map();

const setup = () => {
	const outputPath = join(outputFolder, 'src');

	if (existsSync(outputPath)) {
		rmSync(outputPath, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100
		});
	}

	mkdirSync(outputPath, { recursive: true });
};

const runBuildJsonInSourceApp = () => {
	const cwd = resolve(sourceApplicationFolder);

	try {
		// run-script works everywhere, but Windows sometimes needs shell:true
		execSync('npm run-script build-json', {
			cwd,
			stdio: 'inherit',
			shell: process.platform === 'win32'
		});
	} catch (err) {
		console.error('Failed to run: npm run-script build-json');
		throw err;
	}
};

const loadMdaPackage = () => {
	const fullPath = resolve(
		sourceApplicationFolder,
		'public',
		'app.json'
	);

	const fileContent = readFileSync(fullPath, 'utf8');
	mdaPackage = JSON.parse(fileContent);

	Object.assign(mdaPackage.dashboard, mdaPackage.blueprint);
	delete mdaPackage.blueprint;

	const res = JSON.stringify(mdaPackage)
		.replaceAll('"blueprint":', '"wasBlueprint": true, "trait":')
		.replaceAll('"blueprintPrps":', '"traitPrps":');

	mdaPackage = JSON.parse(res);
};

const buildFileSet = (obj, basePath = '') => {
	if (typeof obj !== 'object' || obj === null)
		return;

	Object.entries(obj).forEach(([k, v]) => {
		const currentPath = basePath ? `${basePath}/${k}` : k;

		if (k.endsWith('.json'))
			mapFiles.set(currentPath, { contents: v });

		if (k === 'srcActions' || k === 'srcAction') {
			const contents = `${v.path}.js`
				.split('/')
				.reduce((p, n) => p[n], mdaPackage.dashboard);

			mapFiles.set(v.path, {
				contents,
				type: 'scriptAction'
			});
		}

		if (typeof v === 'object' && v !== null)
			buildFileSet(v, currentPath);
	});
};

const createFile = entry => {
	const { path, type } = entry;

	if (type === 'scriptAction')
		buildScriptAction(entry, mapFiles);
	else if (path.indexOf('theme/') === 0) {
		buildTheme(entry);

		themeNames.push(path.split('/').pop().replace('.json', ''));
	} else
		buildDashboard(entry, mapFiles, dynamicRootTypes);
};

const createFiles = () => {
	//dashboard/index.json is built different and translates into our src/main.jsx
	const { contents: { startup: startupPath } } = mapFiles.get('dashboard/index.json');

	buildHelpers();

	mapFiles.delete('dashboard/contentsIndex.json');

	for (let [k, { contents, type }] of mapFiles.entries()) {
		createFile({
			path: k,
			contents,
			type
		});
	}

	buildMain({
		startupPath,
		themeNames
	});
};

//`concurrency` is only supported by newer ESLint releases. Whichever ESLint ends up resolved
// (the transpiler's own, or a hoisted/older one from an ancestor node_modules) we want to use the
// speed-up when available and still run when it isn't, rather than crash on an unknown option.
const createEslint = () => {
	try {
		return new ESLint({
			fix: true,
			concurrency: 30
		});
	} catch (err) {
		if (err?.code === 'ESLINT_INVALID_OPTIONS')
			return new ESLint({ fix: true });

		throw err;
	}
};

const runEslintOnOutput = async () => {
	const eslint = createEslint();

	const results = await eslint.lintFiles([join(outputFolder, 'src')]);

	await ESLint.outputFixes(results);

	const formatter = await eslint.loadFormatter('stylish');
	const resultText = formatter.format(results);

	const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
	const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);

	//console.log(resultText);
};

const normalizeRelativePath = path => path.replaceAll('\\', '/');

const isSameOrWithinPath = (path, preservedPath) => path === preservedPath || path.startsWith(`${preservedPath}/`);

const shouldPreserveRelativePath = (relativePath, preservedPaths) => {
	const normalizedPath = normalizeRelativePath(relativePath);

	return preservedPaths.some(preservedPath => isSameOrWithinPath(normalizedPath, preservedPath) || isSameOrWithinPath(preservedPath, normalizedPath));
};

const copyFolderContentsRecursive = (sourceFolder, destinationFolder, {
	deleteExtra = false,
	preservedPaths = []
} = {}) => {
	if (!existsSync(sourceFolder))
		return;

	mkdirSync(destinationFolder, { recursive: true });

	if (deleteExtra && existsSync(destinationFolder)) {
		const sourceNames = new Set(readdirSync(sourceFolder));

		readdirSync(destinationFolder).forEach(name => {
			if (sourceNames.has(name))
				return;

			if (shouldPreserveRelativePath(name, preservedPaths))
				return;

			rmSync(join(destinationFolder, name), {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100
			});
		});
	}

	readdirSync(sourceFolder).forEach(name => {
		const sourcePath = join(sourceFolder, name);
		const destinationPath = join(destinationFolder, name);

		if (statSync(sourcePath).isDirectory()) {
			const preserveWholeFolder = preservedPaths.includes(name);

			if (preserveWholeFolder && existsSync(destinationPath))
				return;

			const nestedPreservedPaths = preservedPaths
				.filter(preservedPath => isSameOrWithinPath(preservedPath, name) || isSameOrWithinPath(name, preservedPath))
				.map(preservedPath => preservedPath === name
					? ''
					: preservedPath.startsWith(`${name}/`)
						? preservedPath.slice(name.length + 1)
						: preservedPath)
				.filter(Boolean);

			copyFolderContentsRecursive(sourcePath, destinationPath, {
				deleteExtra: deleteExtra && !preserveWholeFolder,
				preservedPaths: nestedPreservedPaths
			});

			return;
		}

		mkdirSync(dirname(destinationPath), { recursive: true });
		copyFileSync(sourcePath, destinationPath);
	});
};

const deleteFolderCrossPlatform = (folderPath, preservedPaths = []) => {
	const fullPath = resolve(folderPath);
	const mainPath = join(fullPath, 'main.jsx');

	let mainContents = null;

	if (!replaceMainJsx) {
		if (existsSync(mainPath)) {
			mainContents = readFileSync(mainPath, 'utf8');
		}
	}

	if (preservedPaths.length > 0 && existsSync(fullPath)) {
		readdirSync(fullPath).forEach(name => {
			if (shouldPreserveRelativePath(name, preservedPaths))
				return;

			rmSync(join(fullPath, name), {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100
			});
		});
	} else {
		rmSync(fullPath, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100
		});
	}

	if (!replaceMainJsx && mainContents !== null) {
		mkdirSync(dirname(mainPath), { recursive: true });
		writeFileSync(mainPath, mainContents, 'utf8');
	}
};

const moveFolderContentsRecursive = (sourceFolder, destinationFolder) => {
	if (!existsSync(sourceFolder))
		return;

	mkdirSync(destinationFolder, { recursive: true });

	readdirSync(sourceFolder).forEach(name => {
		const sourcePath = join(sourceFolder, name);
		const destinationPath = join(destinationFolder, name);

		if (statSync(sourcePath).isDirectory()) {
			moveFolderContentsRecursive(sourcePath, destinationPath);

			rmSync(sourcePath, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100
			});

			return;
		}

		mkdirSync(dirname(destinationPath), { recursive: true });

		try {
			renameSync(sourcePath, destinationPath);
		} catch {
			copyFileSync(sourcePath, destinationPath);
			rmSync(sourcePath, { force: true });
		}
	});
};

const replaceRootActionsWithTraitArray = folderPath => {
	if (!existsSync(folderPath))
		return;

	readdirSync(folderPath).forEach(name => {
		const fullPath = join(folderPath, name);
		const stats = statSync(fullPath);

		if (stats.isDirectory()) {
			replaceRootActionsWithTraitArray(fullPath);
			return;
		}

		if (!name.endsWith('.json'))
			return;
 
		const raw = readFileSync(fullPath, 'utf8');

		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			return;
		}

		if (!parsed || typeof(parsed) !== 'object' || Array.isArray(parsed))
			return;

		if (!Object.prototype.hasOwnProperty.call(parsed, 'actions'))
			return;

		parsed.traitArray = parsed.actions;
		delete parsed.actions;

		writeFileSync(fullPath, JSON.stringify(parsed, null, '\t'), 'utf8');
	});
};

/*
	Copies
		* src/main.css -> output/src/transpiled.css
		* index.html
		* public/*
*/
const copyStaticFiles = () => {
	// 1. main.css -> transpiled.css
	const cssSrc = resolve(
		sourceApplicationFolder,
		'src',
		'main.css'
	);

	const cssDest = resolve(
		outputFolder,
		'src',
		'transpiled.css'
	);

	if (existsSync(cssSrc)) {
		mkdirSync(dirname(cssDest), { recursive: true });
		copyFileSync(cssSrc, cssDest);
	}

	// 2. index.html
	const htmlSrc = resolve(
		sourceApplicationFolder,
		'index.html'
	);

	const htmlDest = resolve(
		outputFolder,
		'index.html'
	);

	if (existsSync(htmlSrc)) {
		mkdirSync(dirname(htmlDest), { recursive: true });
		copyFileSync(htmlSrc, htmlDest);
	}

	// 3. public/*
	const publicSrc = resolve(
		sourceApplicationFolder,
		'public'
	);

	const publicDest = resolve(
		outputFolder,
		'public'
	);

	// 4. public/*
	const appSrc = resolve(
		sourceApplicationFolder,
		'app'
	);

	const appDest = resolve(
		outputFolder,
		'app'
	);

	if (existsSync(publicSrc)) {
		mkdirSync(publicDest, { recursive: true });
		copyFolderContentsRecursive(publicSrc, publicDest, { deleteExtra: true });
	}

	if (existsSync(appSrc)) {
		mkdirSync(appDest, { recursive: true });
		copyFolderContentsRecursive(appSrc, appDest, { deleteExtra: true });

		const appDashboardDest = resolve(
			outputFolder,
			'app',
			'dashboard'
		);

		const appBlueprintDest = resolve(
			outputFolder,
			'app',
			'blueprint'
		);

		// In every JSON file under blueprint, replace root-level "actions" with "traitArray"
		replaceRootActionsWithTraitArray(appBlueprintDest);

		// Recursively move all files/folders from inside appBlueprintDest to be inside appDashboardDest
		moveFolderContentsRecursive(appBlueprintDest, appDashboardDest);

		if (existsSync(appBlueprintDest)) {
			rmSync(appBlueprintDest, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100
			});
		}
	}
};

function copyCrossPlatform () {
	const outRoot = resolve(outputFolder);
	const destRoot = resolve(targetApplicationFolder);

	const srcSrc = resolve(outRoot, 'src');
	const srcPublic = resolve(outRoot, 'public');
	const srcIndex = resolve(outRoot, 'index.html');
	const srcApp = resolve(outRoot, 'app');

	const destSrc = resolve(destRoot, 'src');
	const destPublic = resolve(destRoot, 'public');
	const destIndex = resolve(destRoot, 'index.html');
	const destApp = resolve(destRoot, 'app');

	const destMain = resolve(destSrc, 'main.jsx');

	let mainContents = null;

	if (!replaceMainJsx) {
		if (existsSync(destMain)) {
			mainContents = readFileSync(destMain, 'utf8');
		}
	}

	if (existsSync(srcSrc)) {
		const preservedPaths = preservedSrcFolders.map(normalizeRelativePath);

		if (!replaceMainJsx)
			preservedPaths.push('main.jsx');

		copyFolderContentsRecursive(srcSrc, destSrc, {
			deleteExtra: true,
			preservedPaths
		});
	}

	if (existsSync(srcPublic)) {
		copyFolderContentsRecursive(srcPublic, destPublic, {
			deleteExtra: replacePublicFolder
		});
	}

	if (existsSync(srcApp)) {
		copyFolderContentsRecursive(srcApp, destApp, {
			deleteExtra: true
		});
	}

	if (existsSync(srcIndex)) {
		mkdirSync(dirname(destIndex), { recursive: true });
		copyFileSync(srcIndex, destIndex);
	}

	if (!replaceMainJsx && mainContents !== null) {
		mkdirSync(dirname(destMain), { recursive: true });
		writeFileSync(destMain, mainContents, 'utf8');
	}
}

setup();

console.log('Compiling Source App');
runBuildJsonInSourceApp();

console.log('Loading Package');
loadMdaPackage();

console.log('Building Files Map');
buildFileSet(mdaPackage);

//Trait classification during candidate discovery (isFunctionalTrait -> identifyMainTrait) reads the
// shared map-files registry, so initialise it before the analysis passes run (it is re-set per file
// later during transpilation).
initMapFiles(mapFiles);

dynamicRootTypes = analyzeDynamicRootTypes(mapFiles);
initTraitPathFieldMaps(analyzeTraitPathFields(mapFiles));
initDynamicTraitCandidates(analyzeDynamicTraitCandidates(mapFiles));

console.log('Loading Custom Code');
await buildSrcFoldersAndFiles();

console.log('Transpiling');
createFiles();

console.log('Resolving Component-Trait References');
transformOutputTraitRefs(mapFiles);

console.log('Copying Static Files');
copyStaticFiles();

console.log('Linting');
await runEslintOnOutput();

await new Promise(res => setTimeout(res, 200));

console.log('Performing Cleanup');
const targetSrc = resolve(targetApplicationFolder, 'src');

deleteFolderCrossPlatform(targetSrc, preservedSrcFolders.map(normalizeRelativePath));

await new Promise(res => setTimeout(res, 200));

console.log('Copying to Destination');
copyCrossPlatform();
