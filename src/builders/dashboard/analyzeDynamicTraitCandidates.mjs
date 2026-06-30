import { dirname, join } from 'path';

import { isFunctionalTrait } from '../scriptAction.mjs';
import pathToIdentifier from '../pathToIdentifier.mjs';

/*
	Whole-app static discovery of the FUNCTIONAL traits that could be referenced dynamically at runtime
	— i.e. through a trait path that is only known from data (a token trait prop, an array of trait
	refs, or a repeater row's `{{rowData.traits}}`). These are exactly the traits the old global
	`resolveDynamicTrait` registry used to resolve from app.json; discovering them statically lets the
	transpiler emit small per-file maps of DIRECT imports instead.

	Two views are produced, both filtered to functional traits:
	  - fieldCandidates: Map<fieldName, [{ value, path, type }]> — values found as `key: "<trait path>"`
	    object entries in MDA, keyed by the object key. Used for single-token sites
	    (`resolveDynamicTrait(traitPrps.<field>)`), so the emitted map only holds that field's options.
	  - flatCandidates: [{ value, path, type }] — every functional-trait path string found anywhere
	    (object values, bare array elements, and string literals in handler source). Used for array /
	    data-fed sites whose paths can't be narrowed to one field.

	`value` is the literal string exactly as written (the runtime key), `path` the resolved mapFiles
	key, `type` the import identifier.
*/

//A string that could be a trait path: an ensemble path (@scope/...), a relative path (./x, ../x), or
// a dashboard-root-relative path (foo/bar). Plain single tokens and values with spaces are excluded;
// final acceptance is gated on resolving to a real functional-trait file.
const looksLikeTraitPath = value => typeof(value) === 'string' &&
	!value.includes(' ') &&
	(value.startsWith('@') || value.startsWith('./') || value.startsWith('../') || /^[\w-]+\/[\w/-]+$/.test(value));

//A runtime token used as a VALUE: `{{...}}` (data eval/interpolation), `((...))` (repeater/treeview
// row ref), `%field%` / `$field$` (trait-prop substitution). Such a value is resolved at runtime, so
// unless it is a self-referencing pass-through (see below) it makes its field un-narrowable.
const FULL_TOKEN_PATTERNS = [
	/^\(\((.+)\)\)$/,
	/^%(.+)%$/,
	/^\$(.+)\$$/
];

//The field name a full token refers to (last dotted segment), or undefined if not a recognised token.
const tokenInnerField = value => {
	if (typeof(value) !== 'string')
		return;

	for (const pattern of FULL_TOKEN_PATTERNS) {
		const match = value.match(pattern);

		if (match)
			return match[1].split('.').pop();
	}
};

//Whether a string VALUE contains a runtime token of any form (whole or embedded), i.e. it is not a
// statically-known literal. `{{...}}` interpolation, `((...))` repeater/state refs, and `%`/`$`-bracketed
// substitutions all count. (`((...))` is a runtime token per FULL_TOKEN_PATTERNS and must block narrowing
// just like the others — omitting it would let a field fed by `((rowData.x))` be wrongly narrowed.)
const containsRuntimeToken = value => typeof(value) === 'string' &&
	(value.includes('{{') || value.includes('((') || /%[^%]+%/.test(value) || /\$[^$]+\$/.test(value));

//The field a WHOLE prop-substitution token forwards from (`%field%` / `$field$`), or undefined. Unlike a
// `{{...}}` / `((...))` data token (opaque runtime data), a prop token merely passes another prop's value
// through, so on a `trait[A-Z]` config prop it can be resolved as an ALIAS (this field inherits that
// field's bounded candidates) rather than blocking narrowing.
const propTokenInnerField = value => {
	if (typeof(value) !== 'string')
		return;

	const match = value.match(/^%(.+)%$/) || value.match(/^\$(.+)\$$/);

	if (match)
		return match[1].split('.').pop();
};

//A `key: value` entry where the value is a runtime token blocks narrowing of `key` UNLESS the token is
// `key`'s OWN placeholder passed straight through (e.g. `traitDataManager: "%traitDataManager%"`). A
// pass-through introduces no new value — the real values flow in via traitPrps.<key> and are collected
// from the call sites — so it must NOT block narrowing.
const isSelfReferencingPassthrough = (key, value) => tokenInnerField(value) === key;

//Resolve a trait-path string (as written in data) to a mapFiles key. @ and dashboard-root-relative
// paths resolve against the dashboard root; ./ and ../ resolve against the referencing file's folder.
const resolveTraitKey = (value, sourcePath) => {
	if (value.startsWith('@'))
		return `dashboard/${value}.json`;

	if (value.startsWith('./') || value.startsWith('../')) {
		const baseDir = dirname(sourcePath);

		return `${join(baseDir, value).split('\\').join('/')}.json`;
	}

	return `dashboard/${value}.json`;
};

//Matches a quoted ensemble/relative/dashboard-root trait-path string inside handler source.
const HANDLER_TRAIT_STRING_REGEX = /(["'])((?:@|\.\.?\/|[\w-]+\/)[\w/-]+)\1/g;

//Resolve a `{theme.<file>.<path...>}` accessor (as a trait field default would carry) to its static
// theme value. Theme files live in mapFiles under `theme/<file>.json`; the first dotted segment names
// the file, the rest is the path within its contents. Returns undefined if the accessor doesn't fully
// resolve to a value (which the caller must treat as a non-narrowable, unknown default).
const resolveThemeAccessor = (value, mapFiles) => {
	if (typeof(value) !== 'string')
		return;

	const match = value.match(/^\{theme\.([^}]+)\}$/);

	if (!match)
		return;

	const segments = match[1].split('.');
	const themeKey = `theme/${segments[0]}.json`;
	const entry = mapFiles.get(themeKey);

	if (!entry || !entry.contents || typeof(entry.contents) !== 'object')
		return;

	let node = entry.contents;

	for (const segment of segments.slice(1)) {
		if (!node || typeof(node) !== 'object')
			return;

		node = node[segment];
	}

	return node;
};

const analyzeDynamicTraitCandidates = mapFiles => {
	const fieldCandidates = new Map();
	const flatByValue = new Map();

	//Fields proven to carry a non-statically-resolvable value somewhere (an opaque runtime DATA token, or
	// an unresolvable theme default). A non-narrowable field cannot trust its read-side literals as the
	// complete set — but if we discovered where its values are WRITTEN (state writes / aliases), its
	// candidate set is still far smaller than the whole-app flat set, so emission prefers those.
	const nonNarrowableFields = new Set();

	const markNonNarrowable = field => nonNarrowableFields.add(field);

	//field -> Set(targetField): this field's value is forwarded from another prop (a `%target%`/`$target$`
	// token). Candidates and narrowability propagate from target to field after the walk.
	const aliasEdges = new Map();

	const recordAlias = (field, target) => {
		if (!aliasEdges.has(field))
			aliasEdges.set(field, new Set());

		aliasEdges.get(field).add(target);
	};

	const resolveFunctionalTrait = (value, sourcePath) => {
		const key = resolveTraitKey(value, sourcePath);
		const entry = mapFiles.get(key);

		if (!entry || entry.type || !entry.contents || typeof(entry.contents) !== 'object')
			return;

		if (!isFunctionalTrait(entry.contents))
			return;

		//`path` (without the .json extension) is what trait imports use — generateImports resolves it to
		// the transpiled .jsx module. `value` stays the literal runtime key; `type` the import identifier.
		return { value, path: key.replace(/\.json$/, ''), type: pathToIdentifier(key) };
	};

	//Like resolveFunctionalTrait but WITHOUT the isFunctionalTrait rejection, so it also accepts COMPONENT
	// traits (those with a `type`). Used only for `trait[A-Z]` config-trait props (e.g. traitDataManager,
	// traitHeaderCell) where the referenced trait's CONFIG — not its rendered JSX — is merged in via
	// applyTraits. Candidates are flagged `isComponentTrait` so the emitted map entry calls the module's
	// `.traitConfig(prps)` (a config object) rather than the component itself (which returns JSX).
	const resolveConfigTrait = (value, sourcePath) => {
		const key = resolveTraitKey(value, sourcePath);
		const entry = mapFiles.get(key);

		if (!entry || !entry.contents || typeof(entry.contents) !== 'object')
			return;

		return {
			value,
			path: key.replace(/\.json$/, ''),
			type: pathToIdentifier(key),
			isComponentTrait: !isFunctionalTrait(entry.contents)
		};
	};

	const addField = (field, candidate) => {
		if (!fieldCandidates.has(field))
			fieldCandidates.set(field, new Map());

		fieldCandidates.get(field).set(candidate.value, candidate);
	};

	const addFlat = candidate => flatByValue.set(candidate.value, candidate);

	//Walk MDA JSON: object entries contribute to both field and flat sets; bare array-element strings
	// (a trait ref with no key) contribute only to the flat set.
	const walkMda = (node, sourcePath, parentKey) => {
		if (!node || typeof(node) !== 'object')
			return;

		if (Array.isArray(node)) {
			node.forEach(child => {
				if (typeof(child) === 'string' && looksLikeTraitPath(child)) {
					const candidate = resolveFunctionalTrait(child, sourcePath);

					if (candidate) {
						addFlat(candidate);

						if (parentKey)
							addField(parentKey, candidate);
					}

					return;
				}

				walkMda(child, sourcePath, parentKey);
			});

			return;
		}

		Object.entries(node).forEach(([key, value]) => {
			if (typeof(value) === 'string' && looksLikeTraitPath(value)) {
				//A `trait[A-Z]` key (traitDataManager, traitHeaderCell, traitColumnCell, …) names a
				// CONFIG-trait prop: the grid resolves the path and merges the trait's CONFIG via
				// applyTraits. These are frequently COMPONENT traits (e.g. a dataManager with
				// `type: "dataLoader"`), so accept both functional and component traits here. Every other
				// context stays functional-only.
				const candidate = /^trait[A-Z]/.test(key)
					? resolveConfigTrait(value, sourcePath)
					: resolveFunctionalTrait(value, sourcePath);

				if (candidate) {
					addField(key, candidate);
					addFlat(candidate);
				}

				return;
			}

			//A runtime token assigned AS this key's value normally means the key can hold a value only known
			// at runtime → not narrowable. Two exceptions: the key's OWN placeholder passed straight through
			// (`%key%`); and a WHOLE prop token (`%other%`/`$other$`) on a `trait[A-Z]` CONFIG prop, which
			// forwards another config-trait prop's value — recorded as an ALIAS so this field inherits that
			// field's bounded candidates rather than falling back to the whole-app set.
			if (typeof(value) === 'string' && containsRuntimeToken(value) && !isSelfReferencingPassthrough(key, value)) {
				const aliasField = /^trait[A-Z]/.test(key) && propTokenInnerField(value);

				if (aliasField)
					recordAlias(key, aliasField);
				else
					markNonNarrowable(key);
			}

			walkMda(value, sourcePath, key);
		});
	};

	for (const [sourcePath, { contents, type }] of mapFiles.entries()) {
		if (type === 'scriptAction') {
			if (typeof(contents) !== 'string')
				continue;

			//Handler source: every quoted trait-path literal that resolves to a functional trait is a
			// possible runtime value for a data-fed dynamic site (e.g. a repeater row's traits).
			for (const [, , value] of contents.matchAll(HANDLER_TRAIT_STRING_REGEX)) {
				const candidate = resolveFunctionalTrait(value, sourcePath);

				if (candidate)
					addFlat(candidate);
			}

			continue;
		}

		if (!sourcePath.startsWith('dashboard/') || !sourcePath.endsWith('.json'))
			continue;

		walkMda(contents, sourcePath);

		//A trait field's runtime value can be supplied by an acceptPrps DEFAULT rather than a call-site
		// literal. A default that is a theme accessor (`{theme.<file>.<path>}`) must be resolved statically:
		// if it resolves to a trait path, that path is a real candidate the field-scoped map MUST include
		// (e.g. menu_tree's `setDataTrait` default → a theme-stored trait path). A default we can't resolve
		// to a concrete value — an unresolvable theme accessor or any runtime token — means the field can
		// hold an unknown value, so it is no longer narrowable.
		if (contents && typeof(contents) === 'object' && contents.acceptPrps && typeof(contents.acceptPrps) === 'object') {
			Object.entries(contents.acceptPrps).forEach(([field, spec]) => {
				if (!spec || typeof(spec) !== 'object' || spec.dft === undefined)
					return;

				const dft = spec.dft;

				if (typeof(dft) !== 'string')
					return;

				if (dft.startsWith('{theme.')) {
					const resolved = resolveThemeAccessor(dft, mapFiles);

					if (typeof(resolved) === 'string' && looksLikeTraitPath(resolved)) {
						const candidate = /^trait[A-Z]/.test(field)
							? resolveConfigTrait(resolved, sourcePath)
							: resolveFunctionalTrait(resolved, sourcePath);

						if (candidate) {
							addField(field, candidate);
							addFlat(candidate);

							return;
						}
					}

					//Theme default that doesn't resolve to a known trait path — its real value is opaque.
					markNonNarrowable(field);

					return;
				}

				//A non-theme default that is a runtime token (not a self-referencing pass-through) is also
				// an unknown value for the field.
				if (containsRuntimeToken(dft) && !isSelfReferencingPassthrough(field, dft))
					markNonNarrowable(field);
			});
		}
	}

	//Resolve alias edges: a field whose value is forwarded from another prop (`%target%`/`$target$`)
	// inherits that target's candidates and its non-narrowability. Following the whole alias chain from
	// each field reaches every transitive target and unions in their DIRECT candidates — so e.g.
	// `traitReorderedRecordsManager: "$traitModifiedRecordsManager$"` inherits that field's real options
	// instead of falling back to the whole-app set.
	for (const field of aliasEdges.keys()) {
		const seen = new Set();
		const stack = [...aliasEdges.get(field)];

		while (stack.length) {
			const target = stack.pop();

			if (seen.has(target))
				continue;

			seen.add(target);

			const targetCandidates = fieldCandidates.get(target);

			if (targetCandidates)
				for (const candidate of [...targetCandidates.values()])
					addField(field, candidate);

			if (nonNarrowableFields.has(target))
				markNonNarrowable(field);

			if (aliasEdges.has(target))
				for (const next of aliasEdges.get(target))
					stack.push(next);
		}
	}

	//Deterministic order (by literal value) for stable output.
	const sortCandidates = list => [...list].sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

	return {
		fieldCandidates: new Map(
			[...fieldCandidates.entries()].map(([field, byValue]) => [field, sortCandidates(byValue.values())])
		),
		flatCandidates: sortCandidates(flatByValue.values()),
		//A field is narrowable unless it was proven to carry a non-statically-resolvable value. Exposed so
		// emission can gate field-scoped maps: narrowable → field subset, otherwise the whole-app flat set.
		nonNarrowableFields
	};
};

export default analyzeDynamicTraitCandidates;
