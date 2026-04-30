const mainPrefix = `
	import React from 'react';
	import { ExternalComponent, isConditionMet, getThemeValue, getDeepProperty, generateGuid } from '@intenda/opus-ui';
`;

const mainPrefixHasMainTrait = `
	import React, { useEffect, useState } from 'react';
	import { ExternalComponent, getSyncScriptResult, isConditionMet, getThemeValue, getDeepProperty, generateGuid } from '@intenda/opus-ui';
`;

const functionPrefix = `
	const Component = ({ scope, ...rest }) => {
		return (
`;

const functionPrefixHasMainTrait = `
	const Component = ({ scope, prps, traitPrps = {}, ...rest }) => {
		const [ready, setReady] = useState(false);

		useEffect(setTraitPrps.bind(null, traitPrps, rest.auth, setReady), [traitPrps]);

		if (!ready)
			return null;

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

	export default Component;
`;

const functionSuffixHasMainTrait = `
		);
	};

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
