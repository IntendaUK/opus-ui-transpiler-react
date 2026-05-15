import { getIsTrait } from './isTrait.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';

const replaceTraitPropTokens = rawValue => rawValue
	.replace(/%([A-Za-z0-9][^%]*[A-Za-z0-9])%/g, (_, token) => {
		return `\${getDeepProperty(traitPrps, '${token}')}`;
	})
	.replace(/\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$/g, (_, token) => {
		return `\${getDeepProperty(traitPrps, '${token}')}`;
	});

// This function is called with a value already wrapped in a JS string literal,
// e.g. JSON.stringify(v) => "\"hello\"" or "\"$id$\"". Theme replacement can
// also pass generated template literals through here.
const injectTraitPrpsInString = string => {
	if (!getIsTrait())
		return string;

	const quote = string[0];

	// This helper only handles full string/template literals
	if (
		(quote !== '"' && quote !== '`') ||
		string[string.length - 1] !== quote
	)
		return string;

	const rawValue = string.slice(1, -1);

	// If the entire string is exactly "$...$",
	// return the accessor directly without quotes.
	const fullDollarMatch = rawValue.match(/^\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$$/);
	if (fullDollarMatch)
		return buildTraitPrpsAccessor(fullDollarMatch[1]);

	// If the entire string is exactly "%...%",
	// keep existing behavior and return the accessor directly too.
	const fullPercentMatch = rawValue.match(/^%([A-Za-z0-9][^%]*[A-Za-z0-9])%$/);
	if (fullPercentMatch)
		return buildTraitPrpsAccessor(fullPercentMatch[1]);

	// Replace embedded tokens inside normal string content.
	const hasPercentTokens = /%([A-Za-z0-9][^%]*[A-Za-z0-9])%/.test(rawValue);
	const hasDollarTokens = /\$([A-Za-z0-9](?:[^$]*[A-Za-z0-9])?)\$/.test(rawValue);

	if (!hasPercentTokens && !hasDollarTokens)
		return string;

	if (quote === '`')
		return `\`${replaceTraitPropTokens(rawValue)}\``;

	const interpolated = replaceTraitPropTokens(rawValue
		.replaceAll('`', '\\`')
		.replaceAll('${', '\\${'));

	return `\`${interpolated}\``;
};

export default injectTraitPrpsInString;
