import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const defaultSourceApplicationFolder = resolve(workspaceRoot, 'packages', 'original-app');
const defaultTargetApplicationFolder = resolve(workspaceRoot, 'packages', 'legoz');
const defaultReplaceMainJsx = false;
const defaultReplacePublicFolder = true;
const defaultPreservedSrcFolders = ['themes'];

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
export const replaceMainJsx = parseBool(process.env.OPUS_TRANSPILER_REPLACE_MAIN_JSX, defaultReplaceMainJsx);
export const replacePublicFolder = parseBool(process.env.OPUS_TRANSPILER_REPLACE_PUBLIC_FOLDER, defaultReplacePublicFolder);
export const preservedSrcFolders = parseList(process.env.OPUS_TRANSPILER_PRESERVED_SRC_FOLDERS, defaultPreservedSrcFolders);
