//Getters / Setters
import { getIsTrait } from './isTrait.mjs';
import { getOriginalPath } from './originalFile.mjs';
import { pushToScriptImports } from './scriptImports.mjs';
import { getIsFunctionalTrait } from './isFunctionalTrait.mjs';
import { setNeedsDynamicTraitResolver, setNeedsConditionalRootType } from './generateImports.mjs';
import { getTraitImports, pushToTraitImports } from './traitImports.mjs';
import { getUsedComponentTypes, pushToUsedComponentTypes } from './usedComponentTypes.mjs';

//Helpers
import buildTraitsInfo from './buildTraitsInfo.mjs';
import findComponentLibraryName from './findComponentLibraryName.mjs';
import findLocalComponentPath from './findLocalComponentPath.mjs';
import injectTraitPrpsInString from './injectTraitPrpsInString.mjs';
import pathToIdentifier from '../pathToIdentifier.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';

const isMustacheAccessor = value => (
	typeof(value) === 'string' &&
	value.indexOf('{{') === 0 &&
	value.lastIndexOf('}}') === value.length - 2
);

const hasDynamicRowTraits = prps => {
	if (!prps || typeof(prps) !== 'object')
		return false;

	if (isMustacheAccessor(prps.traits))
		return true;

	return Object.values(prps).some(value => {
		if (Array.isArray(value))
			return value.some(hasDynamicRowTraits);

		if (typeof(value) === 'object' && value !== null)
			return hasDynamicRowTraits(value);

		return false;
	});
};

const isValidBareObjectKey = key => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

const buildObjectKey = key => {
	if (isValidBareObjectKey(key))
		return key;

	return JSON.stringify(key);
};

const escapeTemplateInterpolations = value => value.replace(/(?<!\\)\$\{/g, '\\${');

//Opus treats these prop types as arrays that are concatenated (not replaced) when a node and a
// trait/consumer both supply them — see the `arrayPrps` list in the generated `applyTraits` helper.
// A root component spreads the caller's `...prps` over its own defaults, so without special handling
// a parent passing any of these would clobber the component's built-in value (e.g. dropping the
// component's own `scps`, silently disabling its scripts). We merge them instead.
const ARRAY_MERGE_PRPS = [
	'scps',
	'flows',
	'morphProps',
	'lookupFilters',
	'lookupFlows',
	'traitMappings'
];

const scriptActionPassthroughKeys = new Set([
	'actionCondition',
	'hasSideEffects',
	'isAsync',
	'log',
	'pushToVariable',
	'storeAsVariable'
]);

const splitScriptActionProps = prps => {
	const configPrps = {};
	const passthroughPrps = {};

	Object.entries(prps).forEach(([key, value]) => {
		if (scriptActionPassthroughKeys.has(key))
			passthroughPrps[key] = value;
		else
			configPrps[key] = value;
	});

	return {
		configPrps,
		passthroughPrps
	};
};

//Export
const buildProps = ({
	prps,
	isRootLevel,
	keyName = 'prps',
	wrap = true,
	isArray = false,
	isInRowMda = false,
	debugPath = []
}) => {
	let combined = {};

	if (prps)
		Object.assign(combined, prps);

	if (!isInRowMda && hasDynamicRowTraits(combined.rowMda)) {
		combined.resolveDynamicTrait = 'resolveDynamicTrait';
		setNeedsDynamicTraitResolver(true);
	}

	const lines = [];

	//A root trait component receives the caller's props via a `...prps` spread. Array-typed Opus
	// props must survive that spread by being merged, so we defer them past `...prps` (see below).
	const isRootTrait = isRootLevel && getIsTrait() && !getIsFunctionalTrait();
	const mergedArrayLines = [];

	Object.entries(combined).forEach(([k, v]) => {
		//If we're in a script action that has a handler, ignore all other prps
		if (prps.srcAction && k !== 'srcAction')
			return;

		const key = buildObjectKey(k);

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
				const { configPrps, passthroughPrps } = splitScriptActionProps(otherPrps);

				// srcAction JSON parameters belong under config; processAction control keys stay top-level.
				const scriptActionPrps = {
					...passthroughPrps,
					config: configPrps
				};
				const scriptPrps = buildProps({
					prps: scriptActionPrps,
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
			//A local app component (src/components/<type>) is just as valid a row component type
			// as a library component, so accept either.
			const componentLibrary = findLocalComponentPath(v) || findComponentLibraryName(v);

			if (componentLibrary) {
				if (!getUsedComponentTypes().includes(v))
					pushToUsedComponentTypes(v);

				lines.push(`${key}: ${v[0].toUpperCase() + v.substring(1)}`);

				return;
			}
		} else if (isInRowMda && k === 'traits') {
			if (isMustacheAccessor(v)) {
				setNeedsDynamicTraitResolver(true);
				lines.push(`${key}: ${JSON.stringify(v)}`);

				return;
			}

			const traitsInfo = buildTraitsInfo(prps, { isInRowMda });

			if (!traitsInfo) {
				console.error('[opus-ui-transpiler] Failed to build traitsInfo while building rowMda props', {
					file: getOriginalPath(),
					propPath: [...debugPath, k].join('.'),
					component: {
						id: prps.id,
						relId: prps.relId,
						scope: prps.scope,
						type: prps.type
					},
					traits: prps.traits
				});
			}

			//A conditional component selector: two or more visual traits each guarded by a
			// condition. The runtime cannot switch the node component via the `traits` array
			// (it invokes those entries as functional traits), so emit a single dispatching
			// `type` plus a `conditionalRootTypes` list whose conditions are resolved per row.
			const conditionalRootTypeTraits = [traitsInfo.mainTrait, ...traitsInfo.otherTraits]
				.filter(t => t && t.type && t.contents?.type && t.condition);

			if (conditionalRootTypeTraits.length > 1) {
				setNeedsConditionalRootType(true);

				const entries = conditionalRootTypeTraits.map(({ type, path, condition, traitPrps }) => {
					if (!getTraitImports().some(f => f.type === type)) {
						pushToTraitImports({
							type,
							path
						});
					}

					const conditionString = buildProps({
						prps: condition,
						wrap: false,
						isInRowMda
					});

					const traitPrpsString = buildProps({
						prps: traitPrps,
						wrap: false,
						isInRowMda
					});

					return `{ condition: {${conditionString}}, type: ${type}, traitPrps: {${traitPrpsString}} }`;
				});

				lines.push('type: renderConditionalRootType');
				lines.push(`conditionalRootTypes: [${entries.join(', ')}]`);

				return;
			}

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
			if (k === 'resolveDynamicTrait') {
				value = v;
			} else if (v[0] === '%' && v[v.length - 1] === '%') {
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
					value = '`' + escapeTemplateInterpolations(
						value.substring(1, value.length - 1).replaceAll('`', '\\`')
					).replace(
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
				isInRowMda: isInRowMda || k === 'rowMda' || k === 'mdaLabel' || k === 'mdaExpander',
				debugPath: [...debugPath, k]
			})}]`;
		} else if (vType === 'object' && v !== null) {
			value = `{${buildProps({
				prps: v,
				wrap: false,
				isInRowMda: isInRowMda || k === 'rowMda' || k === 'mdaLabel' || k === 'mdaExpander',
				debugPath: [...debugPath, k]
			})}}`;
		}

		if (isArray)
			lines.push(value);
		else if (isRootTrait && ARRAY_MERGE_PRPS.includes(k)) {
			//Defer past `...prps` and merge the caller's value with the component's own, so a parent
			// passing this prop augments the component's built-in array rather than replacing it.
			mergedArrayLines.push(`${key}: [...(prps?.${k} ?? []), ...${value}]`);
		} else
			lines.push(`${key}: ${value}`);
	});

	if (isRootTrait) {
		lines.push('...prps');

		//Re-apply the merged array props after the spread so the caller's `...prps` can't clobber them.
		lines.push(...mergedArrayLines);
	}

	if (lines.length === 0)
		return '';

	if (wrap)
		return `${keyName}={{${lines.join(',')}}}`;

	return lines.join(',');
};

export default buildProps;
