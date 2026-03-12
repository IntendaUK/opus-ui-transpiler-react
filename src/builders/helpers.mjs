//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Templates
const template = `
	export const applyTraits = ({ sysPrps = {}, prps = {}, traits = [] }) => {
		const arrayPrps = [
			'scps',
			'flows',
			'morphProps',
			'lookupFilters',
			'lookupFlows',
			'traitMappings'
		];

		const res = {
			...sysPrps,
			prps: {
				...prps
			}
		};

		traits.forEach(t => {
			if (!t)
				return;

			if (res.scope && t.scope) {
				const combinedScope = Array.isArray(res.scope) ? res.scope : [res.scope];

				if (Array.isArray(t.scope)) {
					t.scope.forEach(s => {
						if (!combinedScope.includes(s))
							combinedScope.push(s);
					});
				} else if (!combinedScope.includes(t.scope))
					combinedScope.push(t.scope);

				res.scope = combinedScope;

				delete t.scope;
			}

			arrayPrps.forEach(p => {
				if (t?.prps?.[p]?.length && res?.prps?.[p]?.length) {
					res.prps[p].push(...t.prps[p]);

					delete t.prps[p];
				}
			});

			if (t?.prps)
				Object.assign(res.prps, { ...t.prps });

			Object.keys(t).forEach(key => {
				if (key === 'prps')
					return;

				res[key] = t[key];
			});
		});

		return res;
	};
`;

//Builder
const buildHelpers = () => {
	const outputPath = join('output', 'src', 'helpers.jsx');

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, template, 'utf8');
};

export default buildHelpers;
