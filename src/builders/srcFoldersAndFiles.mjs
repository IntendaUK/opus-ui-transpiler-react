//Imports
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

//Config
import { sourceApplicationFolder } from '../config.mjs';

const buildSrcFoldersAndFiles = async () => {
	const checkPath = resolve(sourceApplicationFolder, 'src');

	const targetPath = resolve('output', 'src');

	if (!existsSync(checkPath))
		return;

	mkdirSync(targetPath, { recursive: true });

	if (process.platform === 'win32') {
		try {
			execSync(
				`robocopy "${checkPath}" "${targetPath}" /E /NFL /NDL /NJH /NJS /NC /NS /NP`,
				{ stdio: 'ignore' }
			);
		} catch (err) {
			// Robocopy returns 0–3 for success
			if (err.status > 3)
				throw err;
		}
	} else
		execSync(`cp -R "${checkPath}/." "${targetPath}"`);

	const mainJsxPath = join(targetPath, 'main.jsx');
	const mainCssPath = join(targetPath, 'main.css');

	if (existsSync(mainJsxPath))
		rmSync(mainJsxPath, { force: true });

	if (existsSync(mainCssPath))
		rmSync(mainCssPath, { force: true });
};

export default buildSrcFoldersAndFiles;
