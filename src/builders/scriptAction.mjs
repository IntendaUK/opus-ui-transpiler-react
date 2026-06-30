import { outputFolder } from '../config.mjs';
//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Helpers
import pathToIdentifier from './pathToIdentifier.mjs';
import identifyMainTrait from './dashboard/identifyMainTrait.mjs';
import { initMapFiles } from './dashboard/mapFiles.mjs';
import { CONFIG_TRAIT_IMPORT_FIELDS } from './dashboard/configTraitImportFields.mjs';

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

//Matches a CONFIG-trait field (traitDataManager / traitModifiedRecordsManager / traitReorderedRecordsManager)
// whose value is a static trait path. These fields are passed to a shared component (e.g. the grid) which
// calls the value as a config function, so a literal path here is resolved through that component's
// whole-app candidate map at runtime. Converting it to a direct import (see Pass 1b) removes the need for
// that map. Capture groups mirror TRAIT_REFERENCE_REGEX: key-quote, key, colon, value-quote, path.
const CONFIG_TRAIT_FIELD_REGEX = new RegExp(
	`(["']?)(${[...CONFIG_TRAIT_IMPORT_FIELDS].join('|')})\\1(\\s*:\\s*)(["'\`])((?:@|\\.\\.?\\/)[^"'\`$]+)\\4`,
	'g'
);

//Matches a trait-list prop (e.g. `traitsTreeNode: [ ... ]`) whose value is an array literal. By Opus
// convention these props are named `traits<Suffix>` (plural "traits" + CamelCase) and hold bare
// trait-path strings that a library component (treeview/repeater) applies to each node it builds.
// Capture groups: key-quote, key, colon, array-body. The body is matched non-greedily up to the first
// closing bracket — trait-list props are flat string arrays, so this does not span nested structures.
const TRAIT_LIST_PROP_REGEX = /(["']?)(traits[A-Z]\w*)\1(\s*:\s*)\[([\s\S]*?)\]/g;

//Matches a single quoted ensemble/relative trait path (the elements inside a trait-list array).
const TRAIT_PATH_STRING_REGEX = /(["'])((?:@|\.\.?\/)[^"']+)\1/g;

//As above but accepts ANY quote style — including backticks, which hand-written / morph-built
// components use for their trait-path strings (e.g. a `setVariable` base-trait array). `$` is excluded
// from the path so interpolated templates (handled by the dynamic-template pass) never match.
const TRAIT_PATH_STRING_ANY_QUOTE_REGEX = /(["'`])((?:@|\.\.?\/)[^"'`$]+)\1/g;

//Matches an array literal whose elements are ALL trait-path strings (single quote style), e.g. a
// script's `value: [`@…/onValueChanged`, `@…/setErrorStyles`]` base-trait list. Requiring every element
// to be a trait path means mixed/data arrays never match, so converting in place is safe anywhere.
const PURE_TRAIT_PATH_ARRAY_REGEX = /\[\s*(?:(["'`])(?:@|\.\.?\/)[^"'`$]+\1\s*,?\s*)+\]/g;

//Matches a trait-list prop declared as a PROP SPEC with a default array, e.g.
//   traitsUnionDOFields: { type: "array", dft: () => ["@…/index"] }
// The trait paths live in the `dft` default (optionally a `() =>` thunk), not in a bare array literal
// right after the key, so TRAIT_LIST_PROP_REGEX misses them. Capture groups: (1) everything up to and
// including the default array's opening `[`, (2) the array body, (3) the closing `]` — so the body's
// path strings can be converted IN PLACE while the surrounding prop-spec structure is preserved.
const TRAIT_PROP_DEFAULT_REGEX = /(traits[A-Z]\w*\s*:\s*\{[\s\S]*?dft\s*:\s*(?:\([^)]*\)\s*=>\s*)?\[)([\s\S]*?)(\])/g;

//Matches the OPENING of a plain `traits` array — the action-spread form used inside scps/actions, e.g.
//   actions: [{ traits: ["@l2_date_picker/.../setDateString"] }]
// Unlike the `traits[A-Z]` props above, the key is exactly `traits` (no CamelCase suffix), so Pass 2's
// regex never matches it and its bare path-string elements stay unconverted. The lookbehind excludes
// keys that merely END in `traits` (e.g. `someTraits`); the match deliberately stops at the opening
// `[` because these arrays can contain nested objects/arrays, so the matching `]` is found by a
// bracket-depth scan rather than a (truncating) non-greedy regex.
const PLAIN_TRAITS_ARRAY_OPENER_REGEX = /(?<![\w$])(["']?)traits\1\s*:\s*\[/g;

//Find the index of the `]` that closes the array opened at `openBracketIndex` (the index of its `[`),
// tracking bracket depth and skipping over string-literal contents (so brackets inside strings don't
// count). Returns -1 if the array is unbalanced (in which case the caller leaves it untouched).
const findMatchingBracket = (source, openBracketIndex) => {
	let depth = 1;
	let stringDelimiter = null;

	for (let i = openBracketIndex + 1; i < source.length; i++) {
		const ch = source[i];

		if (stringDelimiter) {
			if (ch === '\\') {
				i++;
				continue;
			}

			if (ch === stringDelimiter)
				stringDelimiter = null;

			continue;
		}

		if (ch === '"' || ch === '\'' || ch === '`')
			stringDelimiter = ch;
		else if (ch === '[')
			depth++;
		else if (ch === ']' && --depth === 0)
			return i;
	}

	return -1;
};

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
		const targetPath = key.replace(/\.json$/, '');

		let importPath = getRelativeImportPath(currentPath, targetPath);

		//A FUNCTIONAL trait emitted from a `.js` script handler ALSO produces a `.jsx` trait wrapper at the
		// same base path: the `.js` is the raw action handler (called by the action pipeline with
		// `{ config, getState, … }`), the `.jsx` is the trait form that returns the trait's config. Every
		// site that references a trait calls it as a trait builder (applyTraits' `type(traitPrps)`), which
		// the raw handler is not — calling it crashes (e.g. `config` is undefined). The extension-less
		// import resolves to the `.js` handler (Vite resolves `.js` before `.jsx`), so a colliding trait
		// must target the `.jsx` wrapper explicitly. Mirrors generateImports' getTraitImportPath, keyed off
		// the scriptAction-typed mapFiles entry that marks the `.js`/`.jsx` collision.
		const collisionEntry = mapFiles.get(targetPath) ?? mapFiles.get(targetPath.replace(/^dashboard\//, ''));

		if (collisionEntry?.type === 'scriptAction')
			importPath = `${importPath}.jsx`;

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

	//Pass 1b: CONFIG-trait fields (traitDataManager etc.) whose value is a static trait path. The shared
	// consumer calls the value as a config function (`traitPrps.traitDataManager?.(prps)`), so convert the
	// path to a direct import — `<Import>.traitConfig` for a component trait (the consumer needs the config
	// closure, not the rendered component) or the bare `<Import>` for a functional trait. This is what lets
	// the consumer's whole-app candidate map be suppressed (getDynamicTraitFieldCandidates). Runs file-wide,
	// so it covers both plain traitPrps and the same fields nested inside scps/handler MDA. Forwarding tokens
	// (`%field%`/`$field$`) have no quote+path value, so they never match and stay as accessors. Idempotent:
	// a converted value (`field: Ident.traitConfig`) has no quoted path to re-match.
	transformed = transformed.replace(
		CONFIG_TRAIT_FIELD_REGEX,
		(match, keyQuote, key, colon, valueQuote, traitPath) => {
			const traitKey = resolveTraitKey(traitPath, currentPath);

			if (!traitKey)
				return match;

			const entry = mapFiles.get(traitKey);

			if (!entry || !isConvertibleTrait(entry.contents))
				return match;

			const suffix = isComponentTrait(entry.contents) ? '.traitConfig' : '';

			return `${keyQuote}${key}${keyQuote}${colon}${addImport(traitKey)}${suffix}`;
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

	//Pass 2c: plain `traits` arrays (the action-spread form inside scps/actions, e.g.
	//   { traits: ["@l2_date_picker/.../setDateString"] }
	// ). Each bare path-string element that resolves to a transpiled trait module is converted to a
	// direct import, so the runtime applies the imported (functional) trait instead of resolving the
	// string from app.json — which the self-contained app no longer ships. Object elements
	// (`{ trait: "path" }`) inside these arrays were already handled by Pass 1, and tokens / unresolved
	// paths are left untouched by the inner regex. The array extent is found by a bracket-depth scan
	// (these arrays may hold nested objects/arrays), and conversion is gated on isConvertibleTrait so
	// incidental path-like strings in nested `traitPrps` are not mistaken for trait references.
	const convertTraitPathString = (stringMatch, valueQuote, traitPath) => {
		const traitKey = resolveTraitKey(traitPath, currentPath);

		if (!traitKey)
			return stringMatch;

		const entry = mapFiles.get(traitKey);

		if (!entry || !isConvertibleTrait(entry.contents))
			return stringMatch;

		return addImport(traitKey);
	};

	let plainTraitsResult = '';
	let plainTraitsCursor = 0;
	let opener;

	PLAIN_TRAITS_ARRAY_OPENER_REGEX.lastIndex = 0;

	while ((opener = PLAIN_TRAITS_ARRAY_OPENER_REGEX.exec(transformed))) {
		const openBracketIndex = opener.index + opener[0].length - 1;
		const closeBracketIndex = findMatchingBracket(transformed, openBracketIndex);

		//Unbalanced (shouldn't happen for valid output) — leave this occurrence untouched and continue.
		if (closeBracketIndex === -1)
			continue;

		const body = transformed.slice(openBracketIndex + 1, closeBracketIndex);
		const convertedBody = body.replace(TRAIT_PATH_STRING_REGEX, convertTraitPathString);

		plainTraitsResult += transformed.slice(plainTraitsCursor, openBracketIndex + 1) + convertedBody;
		plainTraitsCursor = closeBracketIndex;

		//Resume scanning after this array (its body's nested path strings are already converted above).
		PLAIN_TRAITS_ARRAY_OPENER_REGEX.lastIndex = closeBracketIndex;
	}

	transformed = plainTraitsResult + transformed.slice(plainTraitsCursor);

	//Pass 2d: pure trait-path-string arrays — array literals whose every element is an @/./.. path,
	// e.g. a component's base-trait list built inside a script:
	//   setVariable value: [`@…/input/functional/onValueChanged`, `@…/input/functional/setErrorStyles`, …]
	// Each element that resolves to a convertible trait becomes a direct import, so at the consuming site
	// (`typeof traitRef === "function" ? traitRef : dynamicTraitMap_array[traitRef]`) it is applied as a
	// function ref and NEVER needs the runtime fallback map. These are compile-time constants — the
	// component's own behaviours — so they should not depend on a data-resolution map at all; leaving them
	// as strings is what forced those files onto the whole-app fallback map (and broke when it was scoped).
	// The regex only matches arrays that are ENTIRELY trait-path strings, so mixed/data arrays are
	// untouched, and per-element conversion is still gated on isConvertibleTrait. Idempotent: an array
	// already converted to identifiers no longer matches.
	transformed = transformed.replace(PURE_TRAIT_PATH_ARRAY_REGEX, arrayMatch =>
		arrayMatch.replace(TRAIT_PATH_STRING_ANY_QUOTE_REGEX, convertTraitPathString)
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
