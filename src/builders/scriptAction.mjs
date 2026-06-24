//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Helpers
import pathToIdentifier from './pathToIdentifier.mjs';
import identifyMainTrait from './dashboard/identifyMainTrait.mjs';
import { initMapFiles } from './dashboard/mapFiles.mjs';

//A trait file is a component-trait (renders to a React component) when it declares its own type, or
// resolves to one through a main trait. Functional traits (no type, no main trait) are left as
// strings so their resolution is unchanged. Guarded: any resolution hiccup falls back to "not a
// component", i.e. leave the reference untouched rather than mis-convert it.
export const isComponentTrait = contents => {
	if (!contents || typeof(contents) !== 'object' || contents.traitArray)
		return false;

	if (contents.type !== undefined)
		return true;

	try {
		return !!identifyMainTrait(contents.traits);
	} catch {
		return false;
	}
};

//Mirror of generateImports' relative-path resolver. Kept local to avoid importing dashboard build
// state (which is initialised per-component, not for standalone handler files).
const getRelativeImportPath = (currentPath, targetPath) => {
	const currentParts = currentPath.split('/');
	const targetParts = targetPath.split('/');

	//Drop the handler's own filename so we resolve relative to its folder.
	currentParts.pop();

	let i = 0;
	while (
		i < currentParts.length &&
		i < targetParts.length &&
		currentParts[i] === targetParts[i]
	)
		i++;

	const ups = currentParts.length - i;
	const upStr = '../'.repeat(ups);
	const remaining = targetParts.slice(i).join('/');

	return (ups === 0 ? './' : upStr) + remaining;
};

//Resolve a trait-path reference (as written inside built MDA) to a transpiler file-map key.
// Absolute ensemble paths look like "@scope/path"; relative paths ("./x", "../x") resolve against
// the referencing file's own folder (currentPath, relative to output/src). Anything else is ignored.
export const resolveTraitKey = (traitPath, currentPath) => {
	if (traitPath.startsWith('@'))
		return `dashboard/${traitPath}.json`;

	if (traitPath.startsWith('./') || traitPath.startsWith('../')) {
		const baseDir = dirname(currentPath);
		const joined = join(baseDir, traitPath).split('\\').join('/');

		return `${joined}.json`;
	}

	return null;
};

//Matches an MDA `trait` reference whose value is a quoted ensemble/relative path, in either JS object
// form (trait: "x") or JSON-ish form ("trait": "x"). Capture groups: key-quote, colon, value-quote,
// path. Only paths beginning with @, ./ or ../ are considered (real trait references).
const TRAIT_REFERENCE_REGEX = /(["']?)trait\1(\s*:\s*)(["'])((?:@|\.\.?\/)[^"']+)\3/g;

//Matches a trait-list prop (e.g. `traitsTreeNode: [ ... ]`) whose value is an array literal. By Opus
// convention these props are named `traits<Suffix>` (plural "traits" + CamelCase) and hold bare
// trait-path strings that a library component (treeview/repeater) applies to each node it builds.
// Capture groups: key-quote, key, colon, array-body. The body is matched non-greedily up to the first
// closing bracket — trait-list props are flat string arrays, so this does not span nested structures.
const TRAIT_LIST_PROP_REGEX = /(["']?)(traits[A-Z]\w*)\1(\s*:\s*)\[([\s\S]*?)\]/g;

//Matches a single quoted ensemble/relative trait path (the elements inside a trait-list array).
const TRAIT_PATH_STRING_REGEX = /(["'])((?:@|\.\.?\/)[^"']+)\1/g;

//Component-traits referenced inside built MDA (e.g. widgets pushed into extraWgts, or widgets built
// by a hand-written local component) are rewritten from a trait-path string into a direct import of
// the transpiled React component, so the runtime renders them as React instead of resolving JSON
// metadata at runtime. Functional traits are left as strings (their resolution is unchanged).
// `currentPath` is the referencing file's path relative to output/src, including its filename
// (e.g. "dashboard/@l2_shell/appTabManager/tOpenTab" or "components/dataPedigree/.../buildFieldWgts").
export const transformTraitReferences = (contents, currentPath, mapFiles) => {
	if (!mapFiles || typeof(contents) !== 'string')
		return contents;

	//identifyMainTrait resolves trait paths through the file map, so make sure it is initialised.
	initMapFiles(mapFiles);

	const imports = new Map();

	//Register an import for a resolved trait key and return the local identifier to reference it by.
	const addImport = key => {
		const identifier = pathToIdentifier(key);
		const importPath = getRelativeImportPath(currentPath, key.replace(/\.json$/, ''));

		imports.set(identifier, importPath);

		return identifier;
	};

	//Pass 1: `trait: "path"` references → direct import of the transpiled COMPONENT (they render to a
	// React component). Functional traits stay as strings here so their existing resolution (via the
	// transpiled app / dynamic-trait registry) is untouched.
	let transformed = contents.replace(
		TRAIT_REFERENCE_REGEX,
		(match, keyQuote, colon, valueQuote, traitPath) => {
			const key = resolveTraitKey(traitPath, currentPath);

			if (!key)
				return match;

			const entry = mapFiles.get(key);

			if (!entry || !isComponentTrait(entry.contents))
				return match;

			return `${keyQuote}trait${keyQuote}${colon}${addImport(key)}`;
		}
	);

	//Pass 2: trait-list props (e.g. `traitsTreeNode: [...]`) hold bare trait-path strings that a
	// library component applies directly to each node it builds. Convert every element that resolves
	// to a transpiled trait module — functional OR component — into a direct import, so these node
	// traits are applied as React rather than resolved from JSON metadata at runtime. Strings that do
	// not resolve to a known trait file are left untouched.
	transformed = transformed.replace(
		TRAIT_LIST_PROP_REGEX,
		(match, keyQuote, key, colon, body) => {
			const convertedBody = body.replace(
				TRAIT_PATH_STRING_REGEX,
				(stringMatch, valueQuote, traitPath) => {
					const traitKey = resolveTraitKey(traitPath, currentPath);

					if (!traitKey || !mapFiles.get(traitKey))
						return stringMatch;

					return addImport(traitKey);
				}
			);

			return `${keyQuote}${key}${keyQuote}${colon}[${convertedBody}]`;
		}
	);

	if (imports.size === 0)
		return contents;

	//Skip identifiers the file already imports (pathToIdentifier is deterministic per path, so a
	// matching identifier is the same component). This keeps the pass safe to run over already-
	// transpiled files that may import the component statically — no duplicate import declarations.
	// Match an existing default import anywhere (transpiled imports are concatenated onto one line,
	// so the import may not be at the start of a line).
	const importLines = [...imports.entries()]
		.filter(([identifier]) => !new RegExp(`\\bimport\\s+${identifier}\\b`).test(contents))
		.map(([identifier, importPath]) => `import ${identifier} from '${importPath}';`)
		.join('\n');

	if (!importLines)
		return transformed;

	return `${importLines}\n\n${transformed}`;
};

//A viewport's `loadFromJsx` prop makes the runtime render the transpiled .jsx dashboard instead of
// resolving JSON metadata at runtime. generateComponent stamps it onto viewport nodes in the static
// component tree, but viewports built imperatively inside handler code (e.g. the tab manager's
// tOpenTab, which constructs `{ type: 'viewport', prps: { value } }` to render an opened tab) never
// pass through that path — so without this they silently fall back to JSON loading. Inject the flag
// into the prps of any `type: 'viewport'` object literal. By Opus metadata convention these literals
// declare `type` immediately followed by a sibling `prps` object, so the flag is added as its first
// key. (Whitespace/newlines between the two are tolerated.)
const VIEWPORT_PRPS_REGEX = /(type\s*:\s*(["'])viewport\2\s*,\s*prps\s*:\s*\{)/g;

export const injectViewportLoadFromJsx = contents => {
	if (typeof(contents) !== 'string')
		return contents;

	return contents.replace(VIEWPORT_PRPS_REGEX, '$1 loadFromJsx: true,');
};

//Helpers
const scriptAction = ({ path, contents }, mapFiles) => {
	let transpiled = transformTraitReferences(contents, `dashboard/${path}`, mapFiles);
	transpiled = injectViewportLoadFromJsx(transpiled);

	const outputPath = join('output', 'src', 'dashboard', path) + '.js';

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default scriptAction;
