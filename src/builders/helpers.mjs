import { outputFolder } from '../config.mjs';
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

//Renders a component's own `wgts` when it is a dynamic trait-prop token, whose runtime value can be
// either shape:
//   1. Already-rendered React elements — a caller passed static Opus MDA that the transpiler turned
//      into JSX (e.g. a modal panel's `wgtsTop: <>…</>`). These render as-is.
//   2. Raw Opus MDA objects (`{ id, traits }`) built at runtime by a script/handler (e.g. an object
//      builder's field widgets). These go through wrapWidgets so each node becomes a real element
//      (resolving a tagged component trait to its imported component).
// The transpiler can't tell which a given site receives — it depends on the caller — so decide at
// runtime. This replaces the old bare `{traitPrps.x}` child, which crashed React when x was raw MDA.
const renderWgtsTemplate = `
	import React from 'react';
	import { wrapWidgets, Component } from '@intenda/opus-ui';

	//Fallback for a raw MDA node that wrapWidgets can't render on its own — i.e. a node with no tagged
	// component trait and no function type, such as a plain container or a string-trait node. Routing it
	// through the Opus Wrapper renders it the same way the runtime renders any dynamically-typed node, so
	// renderWgts handles ANY MDA shape, not only widgets that carry a transpiled component trait.
	const ChildWgt = ({ mda }) => <Component mda={mda} />;

	export const renderWgts = value => {
		if (value === null || value === undefined)
			return null;

		//A single React element/fragment (transpiled static wgts) renders directly.
		if (React.isValidElement(value))
			return value;

		if (Array.isArray(value)) {
			//A list of already-rendered elements renders directly; anything else is raw Opus MDA.
			if (value.every(React.isValidElement))
				return value;

			return wrapWidgets({ ChildWgt, wgts: value });
		}

		//A lone raw MDA node.
		if (typeof value === 'object')
			return wrapWidgets({ ChildWgt, wgts: [value] });

		//A primitive (string/number) is already a valid React child.
		return value;
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

	const renderWgtsPath = join(outputFolder, 'src', 'renderWgts.jsx');

	writeFileSync(renderWgtsPath, renderWgtsTemplate, 'utf8');
};

export default buildHelpers;
