import { outputFolder } from '../config.mjs';
//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Templates
//This MUST mirror the runtime traitManager.applyTraits / combineTraitAndMda, otherwise a trait merge
//here diverges from what the app does at runtime. Two things that are easy to get wrong (and were):
//  1. A trait whose `condition` is not met is SKIPPED (runtime: isConditionMet before applying).
//  2. The merge is NO-OVERRIDE — the accumulator's existing value wins (runtime: cloneNoOverrideNoCopy
//     (mda, trait)). Only the arrayProps concatenate. The previous Object.assign was last-writer-wins,
//     which let a later trait clobber an earlier one's singleton (e.g. a grid's custom dataManager
//     dtaScps getting overwritten by the standard dataManager's).
const template = `
	import { cloneNoOverrideNoCopy, isConditionMet } from '@intenda/opus-ui';

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

			//Skip a trait whose condition isn't met (mirrors traitManager.applyTraits).
			if (t.condition && !isConditionMet(t.condition))
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

			//arrayProps concatenate (mirrors combineArrayProps).
			arrayPrps.forEach(p => {
				if (t?.prps?.[p]?.length && res?.prps?.[p]?.length) {
					res.prps[p].push(...t.prps[p]);

					delete t.prps[p];
				}
			});

			//Everything else: NO-OVERRIDE — the accumulator wins (mirrors cloneNoOverrideNoCopy(mda, trait)).
			//\`condition\` is consumed above, so keep it out of the merge.
			const { condition, ...rest } = t;

			cloneNoOverrideNoCopy(res, rest);
		});

		return res;
	};
`;

//This lives in its own JSX module (kept separate from the plain-JS helpers above) because
// it renders React elements. Per row, it picks the correct node component from a set of
// conditioned alternatives. Each entry's condition is resolved against the row's data by the
// repeater/treeview runtime before this renders, so isConditionMet receives concrete values.
const conditionalRootTypeTemplate = `
	import React from 'react';
	import { isConditionMet } from '@intenda/opus-ui';

	export const renderConditionalRootType = ({ conditionalRootTypes = [], ...rest }) => {
		const match = conditionalRootTypes.find(entry => isConditionMet(entry.condition));

		if (!match)
			return null;

		//A static branch carries its component directly on \`type\`; a data-token branch carries a
		// path-keyed component map plus the (per-row resolved) key to look the component up with.
		const Type = match.type ?? (match.typeMap ? match.typeMap[match.typeKey] : undefined);

		if (!Type)
			return null;

		return <Type {...rest} traitPrps={match.traitPrps} />;
	};
`;

//Renders a component whose type is only known at runtime (a %token%/$token$ type resolved from a
// trait prop). The type string is resolved through the Opus UI component registry the same way the
// runtime resolves dynamic types; wrapped components are cached per type for stable identity.
const dynamicTypeComponentTemplate = `
	import React from 'react';
	import { makeComponentWithChildren } from '@intenda/opus-ui';

	const dynamicTypeCache = {};

	export const DynamicTypeComponent = ({ type, ...rest }) => {
		if (!type)
			return null;

		if (!dynamicTypeCache[type])
			dynamicTypeCache[type] = makeComponentWithChildren(type);

		const Component = dynamicTypeCache[type];

		return <Component {...rest} />;
	};
`;

//A typeless grid-cell node (e.g. a column cell whose \`traits\` is the dynamic \`$innerTraits$\` token)
// may carry a COMPONENT trait — a transpiled component (isTranspiledComponent), not a functional
// config trait. The runtime renders such a trait AS the node's element (wrapWidgets.findComponentTraitIndex);
// merge-calling it (the default functional-trait path) would run a component as a plain function and
// produce nothing. This mirrors that: render the first component trait as the type with the remaining
// traits applied to it, and fall back to merging functional-only lists onto FallbackType. Refs arrive
// resolved-but-uncalled ({ trait, traitPrps }) so the two kinds can be told apart.
const renderDynamicTraitsTemplate = `
	import React from 'react';
	import { applyTraits } from './helpers';

	export const renderDynamicTraits = ({ sysPrps = {}, prps = {}, traits = [], FallbackType }) => {
		//A functional trait's resolved ref is a config function — call it to get its config object (the
		// shape applyTraits merges). Anything already a config object (or a missed map lookup) passes through.
		const toConfig = t => {
			const ref = t?.trait ?? t;

			return typeof ref === 'function' ? ref(t?.traitPrps ?? {}) : ref;
		};

		const componentTrait = traits.find(t => {
			const ref = t?.trait ?? t;

			return typeof ref === 'function' && ref.isTranspiledComponent;
		});

		if (componentTrait) {
			const Type = componentTrait.trait ?? componentTrait;
			const otherTraits = traits.filter(t => t !== componentTrait).map(toConfig);

			return <Type {...applyTraits({ sysPrps, prps, traits: otherTraits })} traitPrps={componentTrait.traitPrps ?? {}} />;
		}

		return <FallbackType {...applyTraits({ sysPrps, prps, traits: traits.map(toConfig) })} />;
	};
`;

//Builder
const buildHelpers = () => {
	const outputPath = join(outputFolder, 'src', 'helpers.jsx');

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, template, 'utf8');

	const conditionalRootTypePath = join(outputFolder, 'src', 'conditionalRootType.jsx');

	writeFileSync(conditionalRootTypePath, conditionalRootTypeTemplate, 'utf8');

	const dynamicTypeComponentPath = join(outputFolder, 'src', 'dynamicTypeComponent.jsx');

	writeFileSync(dynamicTypeComponentPath, dynamicTypeComponentTemplate, 'utf8');

	const renderDynamicTraitsPath = join(outputFolder, 'src', 'renderDynamicTraits.jsx');

	writeFileSync(renderDynamicTraitsPath, renderDynamicTraitsTemplate, 'utf8');
};

export default buildHelpers;
