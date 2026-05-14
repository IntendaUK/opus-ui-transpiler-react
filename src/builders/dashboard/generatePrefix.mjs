const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isIdentifierUsed = (identifier, output) => {
	const regex = new RegExp(`\\b${escapeRegExp(identifier)}\\b`);

	return regex.test(output);
};

const filterNamedImports = (imports, output) => {
	return imports
		.split(',')
		.map(value => value.trim())
		.filter(value => {
			const parts = value.split(/\s+as\s+/);
			const identifier = parts[parts.length - 1];

			return isIdentifierUsed(identifier, output);
		});
};

const filterImportLine = (line, output) => {
	const namedImportMatch = line.match(/^(\s*import\s+)(.*?)\{([^}]+)\}(.*)$/);
	if (!namedImportMatch)
		return line;

	const [, prefix, defaultImport, namedImports, suffix] = namedImportMatch;
	const usedNamedImports = filterNamedImports(namedImports, output);

	if (usedNamedImports.length === 0 && !defaultImport.trim())
		return '';

	if (usedNamedImports.length === 0)
		return `${prefix}${defaultImport.trim().replace(/,$/, '')} ${suffix.trim()}`;

	return `${prefix}${defaultImport}{ ${usedNamedImports.join(', ')} }${suffix}`;
};

const generatePrefix = (prefix, output) => {
	return prefix
		.split('\n')
		.map(line => filterImportLine(line, output))
		.filter(line => line !== '')
		.join('\n');
};

export default generatePrefix;