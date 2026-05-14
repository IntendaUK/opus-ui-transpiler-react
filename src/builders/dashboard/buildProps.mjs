//Getters / Setters
import { getIsTrait } from './isTrait.mjs';
import { getOriginalFile } from './originalFile.mjs';
import { pushToScriptImports } from './scriptImports.mjs';
import { getIsFunctionalTrait } from './isFunctionalTrait.mjs';
import { getTraitImports, pushToTraitImports } from './traitImports.mjs';
import { getUsedComponentTypes, pushToUsedComponentTypes } from './usedComponentTypes.mjs';

//Helpers
import buildTraitsInfo from './buildTraitsInfo.mjs';
import findComponentLibraryName from './findComponentLibraryName.mjs';
import injectTraitPrpsInString from './injectTraitPrpsInString.mjs';
import pathToIdentifier from '../pathToIdentifier.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';

//Export
const buildProps = ({
	prps,
	isRootLevel,
	keyName = 'prps',
	wrap = true,
	isArray = false,
	isInRowMda = false
}) => {
	let combined = {};

	if (prps)
		Object.assign(combined, prps);

	const lines = [];

	Object.entries(combined).forEach(([k, v]) => {
		//If we're in a script action that has a handler, ignore all other prps
		if (prps.srcAction && k !== 'srcAction')
			return;

		let key = k;
		if (key[0] === '^' || key[0] === '.' || key.includes('-') || key.includes(' ') || key.includes('/'))
			key = `"${key}"`;

		let value = JSON.stringify(v);

		if (k === 'srcAction' || k === 'srcActions') {
			const path = `dashboard/${v.path}`;

			const type = pathToIdentifier(path, { capitalizeFirstSegment: false });

			pushToScriptImports({
				type,
				path
			});

			//srcAction (not srcActions) also supports passing extra arguments into handlers
			if (k === 'srcAction' && Object.keys(prps).length > 1) {
				const { srcAction, ...otherPrps } = prps;

				const scriptPrps = buildProps({
					prps: otherPrps,
					wrap: false
				});
				lines.push(`handler: ${type}, ${scriptPrps}`);

				return;
			}

			lines.push(`handler: ${type}`);

			return;
		}

		if (k === 'spread-') {
			const traitProp = v.replaceAll('$', '');
			lines.push(`...${buildTraitPrpsAccessor(traitProp)}`);

			return;
		}

		const vType = typeof(v);

		if (isInRowMda && k === 'type') {
			const componentLibrary = findComponentLibraryName(v);

			if (componentLibrary) {
				if (!getUsedComponentTypes().includes(v))
					pushToUsedComponentTypes(v);

				lines.push(`${key}: ${v[0].toUpperCase() + v.substring(1)}`);

				return;
			}
		} else if (isInRowMda && k === 'traits') {
			const traitsInfo = buildTraitsInfo(prps, { isInRowMda });

			if (traitsInfo.mainTrait) {
				const { type, path } = traitsInfo.mainTrait;

				if (!getTraitImports().some(f => f.type === type)) {
					pushToTraitImports({
						type,
						path
					});
				}

				lines.push(`type: ${type}`);

				const traitPrps = buildProps({
					prps: traitsInfo.mainTrait.traitPrps,
					wrap: false,
					isInRowMda
				});
				lines.push(`traitPrps: {${traitPrps}}`);
			}
			else if (!prps.type) {
				if (!getUsedComponentTypes().includes('label'))
					pushToUsedComponentTypes('label');

				lines.push('type: Label');
			}

			if (traitsInfo.otherTraits.length) {
				const otherTraitsString = traitsInfo.otherTraits
					.map(({ type, traitPrps }) => {
						const res = `{ type: ${type}, traitPrps: ${JSON.stringify(traitPrps)} }`;

						return res;
					})
					.join(',');

				lines.push(`traits: [${otherTraitsString}]`);
			}

			return;
		}

		if (vType === 'string') {
			if (v[0] === '%' && v[v.length - 1] === '%') {
				value = buildTraitPrpsAccessor(v.replaceAll('%', ''));
			} else if (v[0] === '$' && v[v.length - 1] === '$') {
				value = buildTraitPrpsAccessor(v.replaceAll('$', ''));
			} else if (v.indexOf('<>') === 0 || k === 'handler' || v.indexOf('(() => {') === 0)
				value = v;

			//Value will be something like "0 0 {theme.global.padding}"
			// and will be transpiled to `0 0 ${getThemeValue('global.padding')`
			// unless it starts with {theme. and ends in }, then we won't include the wrapping ``
			if (value.includes('{theme.')) {
				if (value.indexOf('"{theme.') === 0 && value.indexOf('}"') === value.length - 2)
					value = `getThemeValue('${value.replace('"{theme.', '').replace('}"', '')}')`;
				else {
					value = '`' + value.substring(1, value.length - 1).replaceAll('`', '\\`').replace(
						/\{theme\.([^}]+)\}/g,
						(_, path) => `\${getThemeValue('${path}')}`
					) + '`';
				}
			}

			//Next we need to replace %key%, %key.subKey%, $key$ and $key.subKey$ accessors
			// with relevant traitPrps accessors
			value = injectTraitPrpsInString(value);
		} else if (Array.isArray(v)) {
			value = `[${buildProps({
				prps: v,
				wrap: false,
				isArray: true,
				isInRowMda: isInRowMda || k === 'rowMda' || k === 'mdaLabel' || k === 'mdaExpander'
			})}]`;
		} else if (vType === 'object' && v !== null) {
			value = `{${buildProps({
				prps: v,
				wrap: false,
				isInRowMda: isInRowMda || k === 'rowMda' || k === 'mdaLabel' || k === 'mdaExpander'
			})}}`;
		}

		if (!isArray)
			lines.push(`${key}: ${value}`);
		else
			lines.push(value);
	});

	if (isRootLevel && getIsTrait() && !getIsFunctionalTrait())
		lines.push('...prps');

	if (lines.length === 0)
		return '';

	if (wrap)
		return `${keyName}={{${lines.join(',')}}}`;

	return lines.join(',');
};

export default buildProps;
