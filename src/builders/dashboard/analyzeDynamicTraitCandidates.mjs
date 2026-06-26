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

const analyzeDynamicTraitCandidates = mapFiles => {
	const fieldCandidates = new Map();
	const flatByValue = new Map();

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
				const candidate = resolveFunctionalTrait(value, sourcePath);

				if (candidate) {
					addField(key, candidate);
					addFlat(candidate);
				}

				return;
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
	}

	//Deterministic order (by literal value) for stable output.
	const sortCandidates = list => [...list].sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

	return {
		fieldCandidates: new Map(
			[...fieldCandidates.entries()].map(([field, byValue]) => [field, sortCandidates(byValue.values())])
		),
		flatCandidates: sortCandidates(flatByValue.values())
	};
};

export default analyzeDynamicTraitCandidates;
