const mainPrefix = `
	import React from 'react';
	import { ExternalComponent, isConditionMet, getThemeValue, getDeepProperty, generateGuid } from '@intenda/opus-ui';
`;

const mainPrefixHasMainTrait = `
	import React, { useMemo } from 'react';
	import { ExternalComponent, getSyncScriptResult, isConditionMet, getThemeValue, getDeepProperty, generateGuid } from '@intenda/opus-ui';
`;

const functionPrefix = `
	const Component = ({ scope, ...rest }) => {
		return (
`;

const functionPrefixHasMainTrait = `
	const Component = ({ scope, prps, traitPrps = {}, ...rest }) => {
		//setTraitPrps only mutates traitPrps via synchronous, script-local operations, so it is
		// safe to run during render. It must re-run whenever a new traitPrps object arrives
		// (e.g. a repeater rebuilding its rows), or the new clone would render uninitialised.
		useMemo(() => setTraitPrps(traitPrps, rest.auth), [traitPrps]);

		return (
`;

const functionPrefixFunctionalTrait = `
	/* eslint-disable */

	const FunctionalTrait = (traitPrps = {}) => {
		const functionalTraitDefaults = __FUNCTIONAL_TRAIT_DEFAULTS__;

		traitPrps = { ...traitPrps };

		Object.entries(functionalTraitDefaults).forEach(([key, value]) => {
			if (traitPrps[key] === undefined)
				traitPrps[key] = value;
		});

		return {
`;

const functionSuffix = `
		);
	};

	//Marks this module as a transpiled Opus component so the runtime can render it directly as React
	// when it is referenced as a component-trait inside dynamically-injected widgets (e.g. extraWgts),
	// instead of resolving it from JSON metadata.
	Component.isTranspiledComponent = true;

	export default Component;
`;

const functionSuffixHasMainTrait = `
		);
	};

	//Marks this module as a transpiled Opus component so the runtime can render it directly as React
	// when it is referenced as a component-trait inside dynamically-injected widgets (e.g. extraWgts),
	// instead of resolving it from JSON metadata.
	Component.isTranspiledComponent = true;

	export default Component;
`;

const functionSuffixFunctionalTrait = `
	};
	};

	export default FunctionalTrait;
`;

const templates = {
	mainPrefix,
	mainPrefixHasMainTrait,
	functionPrefix,
	functionPrefixHasMainTrait,
	functionPrefixFunctionalTrait,
	functionSuffix,
	functionSuffixHasMainTrait,
	functionSuffixFunctionalTrait
};

export default templates;
