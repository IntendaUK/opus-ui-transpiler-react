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
