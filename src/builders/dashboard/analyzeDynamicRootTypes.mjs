import { posix } from 'path';

const isDynamicTypeToken = value => typeof(value) === 'string' &&
	((value.startsWith('%') && value.endsWith('%')) || (value.startsWith('$') && value.endsWith('$')));

const getTokenName = token => token.slice(1, -1);

const normalizeDashboardTraitPath = (traitPath, currentPath) => {
	if (!traitPath)
		return;

	const normalizedTraitPath = traitPath.endsWith('.json') ? traitPath : `${traitPath}.json`;

	if (normalizedTraitPath.startsWith('.')) {
		const currentDirectory = posix.dirname(currentPath);

		return posix.normalize(posix.join(currentDirectory, normalizedTraitPath));
	}

	return posix.normalize(`dashboard/${normalizedTraitPath}`);
};

const walk = (node, onNode) => {
	if (!node || typeof(node) !== 'object')
		return;

	onNode(node);

	if (Array.isArray(node)) {
		node.forEach(child => walk(child, onNode));

		return;
	}

	Object.values(node).forEach(child => walk(child, onNode));
};

const createDynamicRootTypeEntry = (path, contents) => {
	const token = contents.type;

	return {
		path,
		token,
		propName: getTokenName(token),
		values: new Set(),
		unresolvedValues: [],
		usages: []
	};
};

const analyzeDynamicRootTypes = mapFiles => {
	const dynamicRootTypeMap = new Map();

	for (const [path, { contents, type }] of mapFiles.entries()) {
		if (type || !path.startsWith('dashboard/') || !path.endsWith('.json'))
			continue;

		if (isDynamicTypeToken(contents?.type))
			dynamicRootTypeMap.set(path, createDynamicRootTypeEntry(path, contents));
	}

	for (const [sourcePath, { contents, type }] of mapFiles.entries()) {
		if (type || !sourcePath.startsWith('dashboard/') || !sourcePath.endsWith('.json'))
			continue;

		walk(contents, node => {
			if (!Array.isArray(node.traits))
				return;

			node.traits.forEach(trait => {
				if (typeof(trait) === 'string')
					return;

				const traitPath = normalizeDashboardTraitPath(trait.trait, sourcePath);
				const dynamicRootType = dynamicRootTypeMap.get(traitPath);

				if (!dynamicRootType)
					return;

				const value = trait.traitPrps?.[dynamicRootType.propName];

				if (typeof(value) === 'string' && !isDynamicTypeToken(value)) {
					dynamicRootType.values.add(value);
					dynamicRootType.usages.push({ sourcePath, value });

					return;
				}

				dynamicRootType.unresolvedValues.push({ sourcePath, value });
			});
		});
	}

	return new Map([...dynamicRootTypeMap.entries()].map(([path, entry]) => [path, {
		...entry,
		values: [...entry.values].sort()
	}]));
};

export default analyzeDynamicRootTypes;
