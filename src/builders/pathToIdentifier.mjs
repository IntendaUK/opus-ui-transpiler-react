const sanitizeIdentifierSegment = segment => {
	const sanitized = segment
		.replaceAll('@', '')
		.replace(/[^a-zA-Z0-9_$]/g, '_');

	return sanitized || '_';
};

const capitalize = value => value[0].toUpperCase() + value.substring(1);

const pathToIdentifier = (path, { capitalizeFirstSegment = true } = {}) => {
	const identifier = path
		.replace(/^dashboard\//, '')
		.replace(/\.json$/, '')
		.split('/')
		.map((segment, i) => {
			const sanitized = sanitizeIdentifierSegment(segment);

			if (i === 0 && !capitalizeFirstSegment)
				return sanitized;

			return capitalize(sanitized);
		})
		.join('');

	if (/^[a-zA-Z_$]/.test(identifier))
		return identifier;

	return `_${identifier}`;
};

export default pathToIdentifier;
