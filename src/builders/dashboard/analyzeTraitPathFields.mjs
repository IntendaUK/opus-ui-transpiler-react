import { dirname, join } from 'path';

//A trait reference token, written as a per-row data token rather than a static path. Covers the
// repeater/treeview `((field))` form as well as the `%field%`/`$field$` trait-prop forms. The field
// name is the LAST dotted segment (e.g. `customHeaderCellTrait` from `((rowData.field.customHeaderCellTrait))`).
const TOKEN_PATTERNS = [
	/^\(\((.+)\)\)$/,
	/^%(.+)%$/,
	/^\$(.+)\$$/
];

export const extractTraitTokenFieldName = value => {
	if (typeof(value) !== 'string')
		return;

	for (const pattern of TOKEN_PATTERNS) {
		const match = value.match(pattern);

		if (match) {
			const inner = match[1];
			const segments = inner.split('.');

			return segments[segments.length - 1];
		}
	}
};

//A string that points at a trait file: an absolute ensemble path (`@scope/...`) or a relative path
// (`./x`, `../x`). Anything else (plain values, tokens, expressions) is not a trait path.
const isTraitPathValue = value => typeof(value) === 'string' &&
	(value.startsWith('@') || value.startsWith('./') || value.startsWith('../'));

//Resolve a trait-path reference (as written in the data) to a transpiler mapFiles key, relative to
// the file the value was found in. Mirrors scriptAction.resolveTraitKey but kept local because the
// source path here is a `dashboard/...` mapFiles key (not an `output/src` path).
const resolveTraitPathKey = (traitPath, sourcePath) => {
	if (traitPath.startsWith('@'))
		return `dashboard/${traitPath}.json`;

	const baseDir = dirname(sourcePath);
	const joined = join(baseDir, traitPath).split('\\').join('/');

	return `${joined}.json`;
};

const walk = (node, onNode) => {
	if (!node || typeof(node) !== 'object')
		return;

	onNode(node);

	if (Array.isArray(node)) {
		node.forEach(child => walk(child, onNode));

		return;
	}

	Object.values(node).forEach(child => walk(child, onNode));
};

//Whole-mapFiles discovery pass: for every object key in every dashboard entry whose value is a
// trait-path that resolves to a real component file, collect that value keyed by the field name.
// The result is `fieldName -> { values, paths }` where `values` are the literal strings as they
// appear in the data (what the repeater substitutes per row, so map keys match the runtime token),
// each paired with the resolved mapFiles key needed to import the transpiled component.
const analyzeTraitPathFields = mapFiles => {
	const fieldMap = new Map();

	const isComponentTraitFile = mapKey => {
		const entry = mapFiles.get(mapKey);

		if (!entry || entry.type)
			return false;

		const { contents } = entry;

		return !!contents && typeof(contents) === 'object';
	};

	for (const [sourcePath, { contents, type }] of mapFiles.entries()) {
		if (type || !sourcePath.startsWith('dashboard/') || !sourcePath.endsWith('.json'))
			continue;

		walk(contents, node => {
			if (Array.isArray(node))
				return;

			Object.entries(node).forEach(([key, value]) => {
				if (!isTraitPathValue(value))
					return;

				const mapKey = resolveTraitPathKey(value, sourcePath);

				if (!isComponentTraitFile(mapKey))
					return;

				if (!fieldMap.has(key))
					fieldMap.set(key, new Map());

				//Keep the value exactly as written (the runtime token substitutes the literal value),
				// paired with the resolved mapFiles key used to build the import.
				fieldMap.get(key).set(value, mapKey);
			});
		});
	}

	//Sort + de-dupe per field for deterministic output.
	return new Map([...fieldMap.entries()].map(([field, valueMap]) => {
		const sortedValues = [...valueMap.keys()].sort();

		return [field, sortedValues.map(value => ({
			value,
			path: valueMap.get(value)
		}))];
	}));
};

export default analyzeTraitPathFields;
