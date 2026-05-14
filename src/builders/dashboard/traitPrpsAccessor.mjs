const validIdentifierRegex = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const numericSegmentRegex = /^(0|[1-9]\d*)$/;

const buildSegmentAccessor = (segment, isFirstSegment) => {
	if (isFirstSegment) {
		if (validIdentifierRegex.test(segment))
			return `.${segment}`;

		return `[${JSON.stringify(segment)}]`;
	}

	if (numericSegmentRegex.test(segment))
		return `?.[${segment}]`;

	if (validIdentifierRegex.test(segment))
		return `?.${segment}`;

	return `?.[${JSON.stringify(segment)}]`;
};

const buildTraitPrpsAccessor = token => {
	const segments = token.split('.');

	return `traitPrps${segments.map((segment, i) => buildSegmentAccessor(segment, i === 0)).join('')}`;
};

export default buildTraitPrpsAccessor;
