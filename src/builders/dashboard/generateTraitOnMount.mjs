import buildProps from './buildProps.mjs';

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
			const script = buildProps({
				wrap: false,
				prps: v
			});

			let morpher = `
				traitPrps.${k} = getSyncScriptResult({${script}});
			`;

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
		const setTraitPrps = (traitPrps, auth, setReady) => {
		${applyDefaults}
		${morphers}
		//Blueprints don't have 'auth' capabilities so they must always override
		${idCondition}

		setReady(true);
	};`;

	return res;
};

export default generateTraitOnMount;
