import { getIsTrait } from './isTrait.mjs';
import { getOriginalFile } from './originalFile.mjs';

// This function is called with a value already wrapped in double quotes,
// e.g. JSON.stringify(v) => "\"hello\"" or "\"$id$\""
const injectTraitPrpsInString = string => {
	if (!getIsTrait())
		return string;

	// This helper only handles full string literals
	if (string[0] !== '"' || string[string.length - 1] !== '"')
		return string;

	const getTraitAccessor = token => {
		if (token.includes(' ') || (token.includes('/') && !token.includes('.')))
			return `traitPrps['${token}']`;

		return `traitPrps.${token.split('.').join('?.')}`;
	};

	const rawValue = string.slice(1, -1);

	// If the entire string is exactly "$...$",
	// return the accessor directly without quotes.
	const fullDollarMatch = rawValue.match(/^\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$$/);
	if (fullDollarMatch)
		return getTraitAccessor(fullDollarMatch[1]);

	// If the entire string is exactly "%...%",
	// keep existing behavior and return the accessor directly too.
	const fullPercentMatch = rawValue.match(/^%([A-Za-z0-9][^%]*[A-Za-z0-9])%$/);
	if (fullPercentMatch)
		return getTraitAccessor(fullPercentMatch[1]);

	// Replace embedded tokens inside normal string content.
	const hasPercentTokens = /%([A-Za-z0-9][^%]*[A-Za-z0-9])%/.test(rawValue);
	const hasDollarTokens = /\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$/.test(rawValue);

	if (!hasPercentTokens && !hasDollarTokens)
		return string;

	const interpolated = rawValue
		.replaceAll('`', '\\`')
		.replaceAll('${', '\\${')
		.replace(/%([A-Za-z0-9][^%]*[A-Za-z0-9])%/g, (_, token) => {
			return `\${getDeepProperty(traitPrps, '${token}')}`;
		})
		.replace(/\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$/g, (_, token) => {
			return `\${getDeepProperty(traitPrps, '${token}')}`;
		});

	return `\`${interpolated}\``;
};

export default injectTraitPrpsInString;
