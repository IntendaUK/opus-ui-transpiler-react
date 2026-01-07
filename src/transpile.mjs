
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { ESLint } from 'eslint';
import { execSync } from 'child_process';

import { sourceApplicationFolder, targetApplicationFolder } from './config.mjs';

import buildMain from './builders/main.mjs';
import buildTheme from './builders/theme.mjs';
import buildHelpers from './builders/helpers.mjs';
import buildDashboard from './builders/dashboard.mjs';
import buildScriptAction from './builders/scriptAction.mjs';

let mdaPackage;
const mapFiles = new Map();
const themeNames = [];

const setup = () => {
	const outputPath = join(process.cwd(), 'output', 'src');

	if (existsSync(outputPath)) {
		rmSync(outputPath, {
			recursive: true,
			force: true
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
			stdio: 'ignore',
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
		buildScriptAction(entry);
	else if (path.indexOf('theme/') === 0) {
		buildTheme(entry);

		themeNames.push(path.split('/').pop().replace('.json', ''));
	} else
		buildDashboard(entry, mapFiles);
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

const runEslintOnOutput = async () => {
	const eslint = new ESLint({
		fix: true,
		concurrency: 'auto'
	});

	const results = await eslint.lintFiles(['output/src/**/*.{js,jsx}']);

	await ESLint.outputFixes(results);

	const formatter = await eslint.loadFormatter('stylish');
	const resultText = formatter.format(results);

	const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
	const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);

	//console.log(resultText);
};

const deleteFolderCrossPlatform = folderPath => {
	const fullPath = resolve(folderPath);

	try {
		if (process.platform === 'win32')
			execSync(`rmdir /s /q "${fullPath}"`);
		else
			execSync(`rm -rf "${fullPath}"`);
	} catch (err) {}
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
		'output',
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
		'output',
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
		'output',
		'public'
	);

	if (existsSync(publicSrc)) {
		mkdirSync(publicDest, { recursive: true });

		if (process.platform === 'win32') {
			try {
				execSync(
					`robocopy "${publicSrc}" "${publicDest}" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP`,
					{ stdio: 'ignore' }
				);
			} catch (err) {
				const code = err.status;

				// Robocopy returns codes 0–3 for success
				if (code > 3) {
					console.error(`Robocopy failed with code ${code}`);
					throw err;
				}
			}
		} else
			execSync(`cp -R "${publicSrc}/." "${publicDest}"`);
	}
};

function copyCrossPlatform () {
	const outRoot = resolve('output');
	const destRoot = resolve(targetApplicationFolder);

	const srcSrc = resolve(outRoot, 'src');
	const srcPublic = resolve(outRoot, 'public');
	const srcIndex = resolve(outRoot, 'index.html');

	const destSrc = resolve(destRoot, 'src');
	const destPublic = resolve(destRoot, 'public');
	const destIndex = resolve(destRoot, 'index.html');

	if (process.platform === 'win32') {
		// src/
		if (existsSync(srcSrc)) {
			try {
				execSync(
					`robocopy "${srcSrc}" "${destSrc}" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP`,
					{ stdio: 'ignore' }
				);
			} catch (err) {
				if (err.status > 3)
					throw err;
			}
		}

		// public/
		if (existsSync(srcPublic)) {
			try {
				execSync(
					`robocopy "${srcPublic}" "${destPublic}" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP`,
					{ stdio: 'ignore' }
				);
			} catch (err) {
				if (err.status > 3)
					throw err;
			}
		}

		// index.html
		if (existsSync(srcIndex)) {
			mkdirSync(dirname(destIndex), { recursive: true });
			copyFileSync(srcIndex, destIndex);
		}
	} else {
		// src/
		if (existsSync(srcSrc))
			execSync(`cp -R "${srcSrc}" "${destSrc}"`);

		// public/
		if (existsSync(srcPublic))
			execSync(`cp -R "${srcPublic}" "${destPublic}"`);

		// index.html
		if (existsSync(srcIndex)) {
			mkdirSync(dirname(destIndex), { recursive: true });
			copyFileSync(srcIndex, destIndex);
		}
	}
}

setup();

console.log('Compiling Source App');
runBuildJsonInSourceApp();

console.log('Loading Package');
loadMdaPackage();

console.log('Building Files Map');
buildFileSet(mdaPackage);

console.log('Transpiling');
createFiles();

console.log('Copying Static Files');
copyStaticFiles();

console.log('Linting');
await runEslintOnOutput();

await new Promise(res => setTimeout(res, 200));

console.log('Performing Cleanup');
const targetSrc = resolve(targetApplicationFolder, 'src');
deleteFolderCrossPlatform(targetSrc);

await new Promise(res => setTimeout(res, 200));

console.log('Copying to Destination');
copyCrossPlatform();
