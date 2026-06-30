import buildProps from './buildProps.mjs';
import extractEvalTraitHandler from './extractEvalTraitHandler.mjs';

const buildDefaultValueExpression = value => {
	if (typeof(value) !== 'string' || !value.includes('{theme.'))
		return JSON.stringify(value, null, '\t');

	const directThemeMatch = value.match(/^\{theme\.([^}]+)\}$/);
	if (directThemeMatch)
		return `getThemeValue('${directThemeMatch[1]}')`;

	const interpolated = value
		.replaceAll('`', '\\`')
		.replaceAll('${', '\\${')
		.replace(/\{theme\.([^}]+)\}/g, (_, path) => `\${getThemeValue('${path}')}`);

	return `\`${interpolated}\``;
};

//Grid cell trait-list fields whose normalization morph clones `columnConfig.<field>` (entries that may
// be COMPONENT trait references) and injects per-cell context. The source clone is JSON-based and routes
// columnConfig through a {{variable}} substitution — both serialize, silently dropping the transpiler's
// direct function-import trait refs, so a component trait reference never survives. We replace ONLY this
// recognized shape with a function-preserving plain-JS normalization. Anything else is left untouched.
const CELL_TRAIT_FIELDS = new Set(['innerTraits', 'extraGridComponentTraits', 'headerTraits']);

//The eval body of a morph spec is the value of the action that assigns the morph variable.
const getMorphEvalBody = v => {
	if (!Array.isArray(v.morphActions))
		return '';

	const action = v.morphActions.find(a => a?.type === 'setVariable' && a.name === v.morphVariable);

	if (!action)
		return '';

	return Array.isArray(action.value) ? action.value.join('\n') : (action.value ?? '');
};

const isCellTraitNormalization = (k, v) => {
	if (!CELL_TRAIT_FIELDS.has(k) || v.morph !== true)
		return false;

	const body = getMorphEvalBody(v);

	return (
		body.includes(`columnConfig.${k}`) &&
		body.includes('.map(') &&
		body.includes('entry.traitPrps')
	);
};

//Shallow per-entry clone (never JSON) preserves function imports; the standard columnConfig /
// columnCellIndex / columnCellValue injection mirrors the source eval. A field whose morph carries a
// stopScript guard yields `undefined` when its source list is absent (matches the source); otherwise `[]`.
const buildCellTraitNormalization = (k, v) => {
	const fallback = v.morphActions.some(a => a?.type === 'stopScript') ? 'undefined' : '[]';

	return `
		traitPrps.${k} = traitPrps.columnConfig?.${k}
			? traitPrps.columnConfig.${k}.map(entry => {
				entry = typeof entry === 'string'
					? { trait: entry, traitPrps: {} }
					: { ...entry, traitPrps: { ...(entry.traitPrps ?? {}) } };

				entry.traitPrps.columnConfig = traitPrps.columnConfig;
				entry.traitPrps.columnCellIndex = traitPrps.columnCellIndex;
				entry.traitPrps.columnCellValue = traitPrps.columnCellValue;

				return entry;
			})
			: ${fallback};
	`;
};

const generateTraitOnMount = ({ acceptPrps, id: idFromRootComponent }, path) => {
	const applyDefaults = Object.entries(acceptPrps)
		.filter(([k, v]) => v.dft !== undefined)
		.map(([k, v]) => {
			if (!v.internal) {
				let defaulter = `
					if (traitPrps.${k} === undefined) {
						traitPrps.${k} = ${buildDefaultValueExpression(v.dft)};
					}
				`;

				Object.entries(acceptPrps).forEach(([k, v]) => {
					defaulter = defaulter.replaceAll(`"%${k}%"`, `traitPrps.${k}`);
				});

				return defaulter;
			}

			return `traitPrps.${k} = ${buildDefaultValueExpression(v.dft)};`;
		})
		.join('');

	const morphers = Object.entries(acceptPrps)
		.filter(([k, v]) => v.morph === true)
		.map(([k, v]) => {
			//A grid cell-trait normalization (innerTraits / extraGridComponentTraits / headerTraits)
			// whose JSON-cloning eval would drop component-trait function imports: emit it as plain JS
			// that preserves the imports. Strictly gated on the field name + the recognized morph shape,
			// so any other morph falls through to the existing emission unchanged.
			if (isCellTraitNormalization(k, v))
				return buildCellTraitNormalization(k, v);

			//A morph eval that references a component trait can't survive as an eval string (the
			// rewritten component import isn't in eval scope). Lift it into a real handler module and
			// call it directly instead. Returns null for anything not matching that strict shape, in
			// which case we fall through to the existing getSyncScriptResult emission.
			if (path) {
				const extracted = extractEvalTraitHandler(k, v, path);

				if (extracted)
					return `traitPrps.${k} = ${extracted.callExpression};`;
			}

			const script = buildProps({
				wrap: false,
				prps: v
			});

			let morpher = `
				traitPrps.${k} = getSyncScriptResult({${script}});
			`;

			//The swap below turns every double-quoted string into a backtick template (so %token%
			// values can interpolate as ${traitPrps.x}). Any literal backtick or ${ already inside a
			// double-quoted VALUE (e.g. an eval that uses a JS template literal like `(${res})`) must
			// be escaped first, or it would prematurely close the template / interpolate at the wrong
			// level. Values that needed token interpolation are already emitted as backtick literals
			// (with their own escaping) by injectTraitPrpsInString, so they are not double-quoted here
			// and are left untouched.
			morpher = morpher.replace(/"(?:[^"\\]|\\.)*"/g, segment =>
				segment.replace(/(?<!\\)`/g, '\\`').replace(/(?<!\\)\$\{/g, '\\${')
			);

			morpher = morpher.replaceAll('"', '`');
			morpher = morpher.replace(/([,{]\s*)`([^`]+)`\s*:/g, '$1[`$2`]:');

			Object.entries(acceptPrps).forEach(([k, v]) => {
				morpher = morpher.replaceAll(`%${k}%`, `\$\{traitPrps.${k}}`);
			});

			return morpher;
		})
		.join('');

	const rootUsesId =
		idFromRootComponent?.includes('%id%') ||
		idFromRootComponent?.includes('$id$');

	const idCondition = rootUsesId
		? `if (!auth?.includes('id') && traitPrps.id !== undefined && !traitPrps.wasBlueprint)
			traitPrps.id = generateGuid();`
		: '';

	const res = `
		const setTraitPrps = (traitPrps, auth) => {
		${applyDefaults}
		${morphers}
		//Blueprints don't have 'auth' capabilities so they must always override
		${idCondition}
	};`;

	return res;
};

export default generateTraitOnMount;
