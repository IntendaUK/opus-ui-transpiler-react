//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Templates
const template = `
	export const applyTraits = ({ sysPrps, prps, traits }) => {
		const res = {
			...sysPrps,
			prps
		};

		traits.forEach(t => {
			if (t?.prps)
				Object.assign(res.prps, { ...t.prps });
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
