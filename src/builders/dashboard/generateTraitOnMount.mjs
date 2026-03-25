import buildProps from './buildProps.mjs';

const generateTraitOnMount = ({ acceptPrps }) => {
	const applyDefaults = Object.entries(acceptPrps)
		.filter(([k, v]) => v.dft !== undefined)
		.map(([k, v]) => {
			if (!v.internal) {
				return `
					if (traitPrps.${k} === undefined) {
						traitPrps.${k} = ${JSON.stringify(v.dft, null, '\t')};
					}
				`;
			}

			return `traitPrps.${k} = ${JSON.stringify(v.dft, null, '\t')};`;
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

			Object.entries(acceptPrps).forEach(([k, v]) => {
				morpher = morpher.replaceAll(`%${k}%`, `\$\{traitPrps.${k}}`);
			});

			return morpher;
		})
		.join('');

	const res = `
		const setTraitPrps = (traitPrps, setReady) => {
		${applyDefaults}
		${morphers}
		setReady(true);
	};`;

	return res;
};

export default generateTraitOnMount;
