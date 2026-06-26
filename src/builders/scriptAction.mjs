import { outputFolder } from '../config.mjs';
//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Helpers
import pathToIdentifier from './pathToIdentifier.mjs';
import identifyMainTrait from './dashboard/identifyMainTrait.mjs';
import { initMapFiles } from './dashboard/mapFiles.mjs';

//A trait file is a component-trait (renders to a React component) when it declares its own type, or
// resolves to one through a main trait. Guarded: any resolution hiccup falls back to "not a
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

//A trait file is a functional-trait (a function the runtime calls to merge config into a node) when
// it is neither a component-trait nor a spread/blueprint trait (traitArray) — i.e. it has no type and
// no main trait. Mirrors the transpiler's own classification (dashboard.mjs: !type && !hasMainTrait).
// These transpile to a callable FunctionalTrait module, so a path reference to one can be rewritten to
// a direct import instead of being resolved from app.json at runtime.
export const isFunctionalTrait = contents => {
	if (!contents || typeof(contents) !== 'object' || contents.traitArray)
		return false;

	if (contents.type !== undefined)
		return false;

	try {
		return !identifyMainTrait(contents.traits);
	} catch {
		return false;
	}
};

//A spread trait carries a `traitArray` that the runtime splices into the surrounding script/traits.
// It transpiles to a module exporting that { acceptPrps, traitArray } object, so a path reference to
// one can be rewritten to a direct import (the runtime applies the imported object instead of fetching
// it from app.json via getTrait).
export const isSpreadTrait = contents =>
	!!contents && typeof(contents) === 'object' && Array.isArray(contents.traitArray);

//A trait reference is convertible to a direct import when it resolves to a transpiled trait module —
// a component-trait, a functional-trait, or a spread trait. Data-driven {{...}}/token references never
// reach here (the reference regex only matches @, ./ and ../ paths), and unresolved paths are filtered
// by the caller, so any resolvable trait is safe to import.
const isConvertibleTrait = contents =>
	isComponentTrait(contents) || isFunctionalTrait(contents) || isSpreadTrait(contents);

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

//Matches an MDA `trait` reference whose value is an ensemble/relative path, in either JS object
// form (trait: "x") or JSON-ish form ("trait": "x"). The value may be ' " or ` delimited — backtick
// (template-literal) refs are common in hand-written components. Only STATIC paths are matched: the
// path char class excludes `$`, so an interpolated template (trait: `@l2_buttons/visual/${type}/index`)
// does not match here and is handled by the dynamic-template pass below. Capture groups: key-quote,
// colon, value-quote, path. Only paths beginning with @, ./ or ../ are considered.
const TRAIT_REFERENCE_REGEX = /(["']?)trait\1(\s*:\s*)(["'`])((?:@|\.\.?\/)[^"'`$]+)\3/g;

//Matches a trait-list prop (e.g. `traitsTreeNode: [ ... ]`) whose value is an array literal. By Opus
// convention these props are named `traits<Suffix>` (plural "traits" + CamelCase) and hold bare
// trait-path strings that a library component (treeview/repeater) applies to each node it builds.
// Capture groups: key-quote, key, colon, array-body. The body is matched non-greedily up to the first
// closing bracket — trait-list props are flat string arrays, so this does not span nested structures.
const TRAIT_LIST_PROP_REGEX = /(["']?)(traits[A-Z]\w*)\1(\s*:\s*)\[([\s\S]*?)\]/g;

//Matches a single quoted ensemble/relative trait path (the elements inside a trait-list array).
const TRAIT_PATH_STRING_REGEX = /(["'])((?:@|\.\.?\/)[^"']+)\1/g;

//Matches a trait-list prop declared as a PROP SPEC with a default array, e.g.
//   traitsUnionDOFields: { type: "array", dft: () => ["@…/index"] }
// The trait paths live in the `dft` default (optionally a `() =>` thunk), not in a bare array literal
// right after the key, so TRAIT_LIST_PROP_REGEX misses them. Capture groups: (1) everything up to and
// including the default array's opening `[`, (2) the array body, (3) the closing `]` — so the body's
// path strings can be converted IN PLACE while the surrounding prop-spec structure is preserved.
const TRAIT_PROP_DEFAULT_REGEX = /(traits[A-Z]\w*\s*:\s*\{[\s\S]*?dft\s*:\s*(?:\([^)]*\)\s*=>\s*)?\[)([\s\S]*?)(\])/g;

//Matches a `trait` reference whose value is an INTERPOLATED template literal, e.g.
//   trait: `@l2_buttons/visual/${type}/index`
// The component segment is only known at runtime, so it can't be a single import. Capture groups:
// key-quote, colon, template body (the path with its ${...} interpolation). Handled by building a map
// of the statically-discoverable candidates, keyed by the interpolated segment value.
const DYNAMIC_TRAIT_TEMPLATE_REGEX = /(["']?)trait\1(\s*:\s*)`((?:@|\.\.?\/)[^`]*\$\{[^}]+\}[^`]*)`/g;

//Traits referenced inside built MDA (e.g. widgets pushed into extraWgts, or widgets built by a
// hand-written local component) are rewritten from a trait-path string into a direct import of the
// transpiled trait module, so the runtime applies them directly instead of resolving JSON metadata at
// runtime. Both component traits (rendered as React) and functional traits (called to merge config)
// are converted; spread/blueprint traits and data-driven {{...}} references are left as strings.
// `currentPath` is the referencing file's path relative to output/src, including its filename
// (e.g. "dashboard/@l2_shell/appTabManager/tOpenTab" or "components/dataPedigree/.../buildFieldWgts").
export const transformTraitReferences = (contents, currentPath, mapFiles) => {
	if (!mapFiles || typeof(contents) !== 'string')
		return contents;

	//identifyMainTrait resolves trait paths through the file map, so make sure it is initialised.
	initMapFiles(mapFiles);

	const imports = new Map();
	//Local `const <name> = { … }` map declarations emitted for dynamic trait templates (Pass 3).
	const mapDecls = [];
	let dynamicMapCount = 0;

	//Register an import for a resolved trait key and return the local identifier to reference it by.
	const addImport = key => {
		const identifier = pathToIdentifier(key);
		const importPath = getRelativeImportPath(currentPath, key.replace(/\.json$/, ''));

		imports.set(identifier, importPath);

		return identifier;
	};

	//Pass 1: `trait: "path"` references → direct import of the transpiled trait module, whether it is a
	// COMPONENT trait (renders to a React component) or a FUNCTIONAL trait (a function the runtime calls
	// to merge config). Either way the reference no longer resolves from app.json at runtime. Spread
	// traits (traitArray) and data-driven {{...}} references are left untouched.
	let transformed = contents.replace(
		TRAIT_REFERENCE_REGEX,
		(match, keyQuote, colon, valueQuote, traitPath) => {
			const key = resolveTraitKey(traitPath, currentPath);

			if (!key)
				return match;

			const entry = mapFiles.get(key);

			if (!entry || !isConvertibleTrait(entry.contents))
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

	//Pass 2b: trait-list props declared as a prop spec with a default array (e.g. a local component's
	// props.js: `traitsUnionDOFields: { type: "array", dft: () => ["@…/index"] }`). The paths sit in the
	// `dft` default, which Pass 2's literal-array form doesn't reach, so they would otherwise stay
	// strings resolved from app.json at runtime. Convert the path strings IN PLACE (prefix + body +
	// closing bracket preserved) so the prop-spec structure is untouched.
	transformed = transformed.replace(
		TRAIT_PROP_DEFAULT_REGEX,
		(match, prefix, body, suffix) => {
			const convertedBody = body.replace(
				TRAIT_PATH_STRING_REGEX,
				(stringMatch, valueQuote, traitPath) => {
					const traitKey = resolveTraitKey(traitPath, currentPath);

					if (!traitKey || !mapFiles.get(traitKey))
						return stringMatch;

					return addImport(traitKey);
				}
			);

			return `${prefix}${convertedBody}${suffix}`;
		}
	);

	//Pass 3: dynamic (interpolated) trait templates, e.g. trait: `@l2_buttons/visual/${type}/index`.
	// The interpolated segment is runtime-only, so instead of one import we discover every static
	// candidate the template could resolve to (mapFiles keys matching the template with its ${...}
	// treated as a single path segment), import each, and emit a local map keyed by the segment value:
	//   const dynamicTraitTemplateMap1 = { "primary": …, "secondary": … };
	//   … trait: dynamicTraitTemplateMap1[type] …
	// Only single-interpolation ensemble (@) paths are handled; anything else is left untouched.
	transformed = transformed.replace(
		DYNAMIC_TRAIT_TEMPLATE_REGEX,
		(match, keyQuote, colon, template) => {
			const interpolations = [...template.matchAll(/\$\{([^}]+)\}/g)];

			if (interpolations.length !== 1 || !template.startsWith('@'))
				return match;

			const segmentExpr = interpolations[0][1];

			//Build a matcher over mapFiles keys: static parts are literal, the ${...} is one segment.
			const staticParts = template
				.split(/\$\{[^}]+\}/)
				.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			const keyMatcher = new RegExp(`^dashboard/${staticParts.join('([^/]+)')}\\.json$`);

			const entries = [];

			for (const [mapKey, entry] of mapFiles.entries()) {
				const matched = mapKey.match(keyMatcher);

				if (!matched || !entry || !isConvertibleTrait(entry.contents))
					continue;

				entries.push(`${JSON.stringify(matched[1])}: ${addImport(mapKey)}`);
			}

			if (!entries.length)
				return match;

			const mapName = `dynamicTraitTemplateMap${++dynamicMapCount}`;

			mapDecls.push(`const ${mapName} = { ${entries.join(', ')} };`);

			return `${keyQuote}trait${keyQuote}${colon}${mapName}[${segmentExpr}]`;
		}
	);

	if (imports.size === 0 && mapDecls.length === 0)
		return contents;

	//Skip identifiers the file already imports (pathToIdentifier is deterministic per path, so a
	// matching identifier is the same component). This keeps the pass safe to run over already-
	// transpiled files that may import the component statically — no duplicate import declarations.
	// Match an existing default import anywhere (transpiled imports are concatenated onto one line,
	// so the import may not be at the start of a line).
	const importLines = [...imports.entries()]
		.filter(([identifier]) => !new RegExp(`\\bimport\\s+${identifier}\\b`).test(contents))
		.map(([identifier, importPath]) => `import ${identifier} from '${importPath}';`);

	//Map declarations reference the imported identifiers, so they follow the imports.
	const prefixLines = [...importLines, ...mapDecls];

	if (!prefixLines.length)
		return transformed;

	return `${prefixLines.join('\n')}\n\n${transformed}`;
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

	const outputPath = join(outputFolder, 'src', 'dashboard', path) + '.js';

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default scriptAction;
