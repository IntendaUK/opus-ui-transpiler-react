import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const transpilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(transpilerRoot, '..');

const defaultSourceApplicationFolder = resolve(workspaceRoot, 'packages', 'original-app');
const defaultTargetApplicationFolder = resolve(workspaceRoot, 'packages', 'legoz');
const defaultReplaceMainJsx = false;
const defaultReplacePublicFolder = true;
const defaultPreservedSrcFolders = [];

const parseBool = (value, fallback) => value === undefined
	? fallback
	: value !== 'false';

const parseList = (value, fallback) => value === undefined
	? fallback
	: value
		.split(',')
		.map(item => item.trim())
		.filter(Boolean);

export const sourceApplicationFolder = process.env.OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER ?? defaultSourceApplicationFolder;
export const targetApplicationFolder = process.env.OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER ?? defaultTargetApplicationFolder;

//The staging folder the transpiler writes/lints before copying to the target. Defaulted per-target
// (output/<targetBasename>) so concurrent or back-to-back transpiles into different targets never
// share files — this is what keeps the test suite from intermittently failing on Windows file-handle
// contention. Kept under the transpiler root so ESLint still resolves this project's config.
export const outputFolder = process.env.OPUS_TRANSPILER_OUTPUT_FOLDER
	?? resolve(transpilerRoot, 'output', basename(targetApplicationFolder));
export const replaceMainJsx = parseBool(process.env.OPUS_TRANSPILER_REPLACE_MAIN_JSX, defaultReplaceMainJsx);
export const replacePublicFolder = parseBool(process.env.OPUS_TRANSPILER_REPLACE_PUBLIC_FOLDER, defaultReplacePublicFolder);
export const preservedSrcFolders = parseList(process.env.OPUS_TRANSPILER_PRESERVED_SRC_FOLDERS, defaultPreservedSrcFolders);
