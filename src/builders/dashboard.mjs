//Imports
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';

//Strings
const mainPrefix = `
	import React from 'react';
	import { ExternalComponent, isConditionMet, getThemeValue } from '@intenda/opus-ui';
`;

const mainPrefixHasMainTrait = `
	import React, { useEffect, useState } from 'react';
	import { ExternalComponent, getSyncScriptResult, isConditionMet, getThemeValue } from '@intenda/opus-ui';
`;

/*const functionPrefix = `
	const Component = ExternalComponent(() => {
		return (
`;*/

const functionPrefix = `
	const Component = rest => {
		return (
`;

const functionPrefixHasMainTrait = `
	const Component = ({ scope, prps, traitPrps = {}, ...rest }) => {
		const [ready, setReady] = useState(false);

		useEffect(setTraitPrps.bind(null, traitPrps, setReady), [traitPrps]);

		if (!ready)
			return null;

		return (
`;

const functionPrefixFunctionalTrait = `
	/* eslint-disable */

	const FunctionalTrait = traitPrps => { return { 
`;

/*const functionSuffix = `
		);
	});

	export default Component;
`;*/

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

//Internals
let currentPath;
let mapFiles;
let traitImports;
let scriptImports;
let usedComponentTypes;
let isTrait;
let isFunctionalTrait;
let needsHelpers;

let refMap = {};

const findComponentLibraryName = componentType => {
	const baseDir = join(process.cwd(), 'node_modules', '@intenda');

	let packages;
	try {
		packages = readdirSync(baseDir, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => d.name);
	} catch {
		console.error('❌ Could not read @intenda directory');

		return null;
	}

	//Move "opus-ui" to the end if it exists because if it DOES contain the type, it should only be
	// used if no other component library provides it
	packages = packages.sort((a, b) => (a === 'opus-ui' ? 1 : b === 'opus-ui' ? -1 : 0));

	for (const pkg of packages) {
		const componentPath = join(baseDir, pkg, 'dist', 'components', componentType);
		if (existsSync(componentPath))
			return `@intenda/${pkg}`;
	}

	return null;
};

const identifyMainTrait = traits => {
	if (!traits || typeof(traits) === 'string')
		return;

	let res;

	traits.forEach(f => {
		if (res)
			return;

		const traitPath = `dashboard/${f.trait ?? f}.json`;
		const trait = mapFiles.get(traitPath);

		if (!trait)
			return;

		const { contents: { type: innerType, traits: innerTraits } } = trait;

		if (innerType)
			res = f;
		else if (innerTraits) {
			const innerRes = identifyMainTrait(trait.contents.traits);

			if (innerRes)
				res = f;
		}
	});

	return res;
};

/*
	Returns {
		mainTrait: {
			type,
			path,
			traitPrps
		},
		otherTraits: [{
			type,
			path
		}],
		combinedTraitPrps,
		serializedTraitPrps
	}
*/
const buildTraitsInfo = ({ traits }) => {
	if (!traits?.length)
		return;

	const res = {
		mainTrait: null,
		otherTraits: null,
		combinedPrps: {}
	};

	res.mainTrait = identifyMainTrait(traits);

	res.otherTraits = [...traits].filter(f => f !== res.mainTrait);

	const getInfoFromTrait = trait => {
		const path = `dashboard/${trait.trait ?? trait}`;
		if (path.includes('$') || path.includes('%'))
			return;

		const loadedTrait = mapFiles.get(`${path}.json`);

		if (!loadedTrait)
			return;

		const { contents } = loadedTrait;

		const type = path
			.replace('@', '')
			.replace('dashboard/', '')
			.split('/')
			.map((t, i) => t[0].toUpperCase() + t.substring(1))
			.join('');

		if (!contents.type) {
			if (!refMap[type])
				refMap[type] = 1;
			else
				refMap[type]++;
		}

		if (!traitImports.some(f => f.type === type)) {
			traitImports.push({
				type,
				path
			});
		}

		const traitPrps = { ...trait.traitPrps };
		const stringifiedContents = JSON.stringify(contents);

		Object.entries(traitPrps).forEach(([k, v]) => {
			if (stringifiedContents.includes(`"wgts":"$${k}$"`))
				traitPrps[k] = `<>${v.map(m => generateComponent(m, false)).join(',')}</>`;
		});

		return {
			type,
			path,
			contents,
			traitPrps
		};
	};

	if (res.mainTrait)
		res.mainTrait = getInfoFromTrait(res.mainTrait);

	res.otherTraits = res.otherTraits
		.map(t => getInfoFromTrait(t))
		.filter(f => !!f);

	res.otherTraits.forEach(({ contents }) => {
		Object.assign(res.combinedPrps, contents.prps);
	});

	return res;
};

const buildProps = ({ prps, isRootLevel, keyName = 'prps', wrap = true, isArray = false }) => {
	let combined = {};

	if (prps)
		Object.assign(combined, prps);

	const lines = [];

	Object.entries(combined).forEach(([k, v]) => {
		//If we're in a script action that has a handler, ignore all other prps
		if (prps.srcAction && k !== 'srcAction')
			return;

		let key = k;
		if (key[0] === '^' || key[0] === '.' || key.includes('-'))
			key = `"${key}"`;

		let value = JSON.stringify(v);

		if (k === 'srcAction' || k === 'srcActions') {
			const path = `dashboard/${v.path}`;

			const type = path
				.replace('@', '')
				.replace('dashboard/', '')
				.split('/')
				.map((t, i) => {
					if (i === 0)
						return t;

					return t[0].toUpperCase() + t.substring(1);
				})
				.join('');

			scriptImports.push({
				type,
				path
			});

			//srcAction (not srcActions) also supports passing extra arguments into handlers
			if (k === 'srcAction' && Object.keys(prps).length > 1) {
				const { srcAction: _ignore, ...otherPrps } = prps;

				const scriptPrps = buildProps({
					prps: otherPrps,
					wrap: false
				});
				lines.push(`handler: ${type}.bind(null, { ${scriptPrps} })`);

				return;
			}

			lines.push(`handler: ${type}`);

			return;
		}

		if (k === 'spread-') {
			const traitProp = v.replaceAll('$', '');
			lines.push(`...traitPrps.${traitProp}`);

			return;
		}

		const vType = typeof(v);

		if (vType === 'string') {
			if (v[0] === '%' && v[v.length - 1] === '%')
				value = `traitPrps.${v.replaceAll('%', '')}`;
			else if (v[0] === '$' && v[v.length - 1] === '$')
				value = `traitPrps.${v.replaceAll('$', '')}`;
			else if (v.indexOf('<>') === 0 || k === 'handler' || v.indexOf('(() => {') === 0)
				value = v;

			//Value will be something like "0 0 {theme.global.padding}"
			// and will be transpiled to `0 0 ${getThemeValue('global.padding')`
			if (value.includes('{theme.')) {
				value = '`' + value.substring(1, value.length - 1).replace(
					/\{theme\.([^}]+)\}/g,
					(_, path) => `\${getThemeValue('${path}')}`
				) + '`';
			}
		} else if (Array.isArray(v)) {
			value = `[${buildProps({
				prps: v,
				wrap: false,
				isArray: true
			})}]`;
		} else if (vType === 'object' && v !== null) {
			value = `{${buildProps({
				prps: v,
				wrap: false
			})}}`;
		}

		if (!isArray)
			lines.push(`${key}: ${value}`);
		else
			lines.push(value);
	});

	if (isRootLevel && isTrait && !isFunctionalTrait)
		lines.push('...prps');

	if (lines.length === 0)
		return '';

	if (wrap)
		return `${keyName}={{${lines.join(',')}}}`;

	return lines.join(',');
};

const generateComponent = (obj, isRootLevel = true) => {
	let { type, prps, wgts, condition } = obj;

	let componentType;

	const traitsInfo = buildTraitsInfo(obj);
	const hasFunctionalTraits = traitsInfo?.otherTraits.length > 0;

	if (hasFunctionalTraits)
		needsHelpers = true;

	if (traitsInfo?.mainTrait)
		componentType = traitsInfo.mainTrait.type;
	else {
		if (!type)
			type = 'label';

		componentType = type[0].toUpperCase() + type.substring(1);

		if (!usedComponentTypes.includes(type))
			usedComponentTypes.push(type);
	}

	let prpsString = buildProps({
		prps,
		traitsInfo,
		isRootLevel,
		wrap: !isFunctionalTrait && !hasFunctionalTraits
	});

	let mainTraitPrpsString = buildProps({
		prps: traitsInfo?.mainTrait?.traitPrps,
		traitsInfo,
		keyName: 'traitPrps'
	});

	let children = [];
	if (Array.isArray(wgts))
		children = wgts.map(component => generateComponent(component, false));
	else if (typeof(wgts) === 'string' && wgts[0] === '$')
		children = [`{traitPrps.${wgts.replaceAll('$', '')}}`];

	let res;

	let sysPrps = [];

	['id', 'scope', 'relId', 'container'].forEach(key => {
		if (!obj[key])
			return;

		let bl = '{';
		let br = '}';
		let s = '=';

		if (hasFunctionalTraits) {
			bl = '';
			br = '';
			s = ':';
		}

		if (key === 'scope') {
			if (isRootLevel)
				sysPrps.push(`${key}${s}${bl}['${obj[key]}', scope]${br}`);
			else
				sysPrps.push(`${key}${s}'${obj[key]}'`);
		} else
			sysPrps.push(`${key}${s}'${obj[key]}'`);
	});
	if (isRootLevel && !obj.scope && traitsInfo?.mainTrait)
		sysPrps.push('scope={scope}');

	let sysPrpsString = sysPrps.join(hasFunctionalTraits ? ',' : ' ');

	let restString = '';
	if (isRootLevel && !isFunctionalTrait)
		restString = '{...rest}';

	let traitsString = '';

	if (hasFunctionalTraits) {
		traitsString = `
			{...applyTraits({ sysPrps: {${sysPrpsString}}, prps: {${prpsString}}, traits: [${traitsInfo.otherTraits.map(t => `${t.type}(${JSON.stringify(t.traitPrps)})`).join(',')}] }) }
		`;

		sysPrpsString = '';
		prpsString = '';
	}

	if (isFunctionalTrait)
		res = `prps: { ${prpsString} }`;
	else {
		const inner = `<${componentType} ${traitsString} ${sysPrpsString} ${mainTraitPrpsString} ${prpsString} ${restString}>${children.join('')}</${componentType}>`;

		if (condition) {
			const conditionString = buildProps({
				prps: condition,
				wrap: false
			});

			res = `{isConditionMet({${conditionString}}) ? ${inner} : null }`;
		} else
			res = inner;
	}

	return res;
};

const getRelativeImportPath = (currentPath, targetPath) => {
	const currentParts = currentPath.split('/');
	const targetParts = targetPath.split('/');

	// Remove filename from current path (index.json)
	currentParts.pop();

	// Find common prefix length
	let i = 0;
	while (i < currentParts.length &&
           i < targetParts.length &&
           currentParts[i] === targetParts[i])
		i++;

	// How many levels to go up
	const ups = currentParts.length - i;
	const upStr = '../'.repeat(ups);

	// Remaining part of target
	const remaining = targetParts.slice(i).join('/');

	return (ups === 0 ? './' : upStr) + remaining;
};

const generateImports = () => {
	const trackedImports = {};

	usedComponentTypes.forEach(type => {
		const componentLibrary = findComponentLibraryName(type);

		if (!trackedImports[componentLibrary])
			trackedImports[componentLibrary] = [type];
		else
			trackedImports[componentLibrary].push(type);
	});

	const res = [
		...Object.entries(trackedImports)
			.map(([k, v]) => {
				const componentTypes = v.map(type => type[0].toUpperCase() + type.substring(1));

				return `import { ${componentTypes.join(', ')} } from '${k}';`;
			}),
		'\n\n',
		...[...traitImports, ...scriptImports]
			.map(({ type, path }) => {
				const relativePath = getRelativeImportPath(currentPath, path);

				return `import ${type} from '${relativePath}';`;
			})
			.flat()
	];

	if (needsHelpers) {
		const relativePath = getRelativeImportPath(currentPath, 'helpers');

		res.push(`import { applyTraits } from '${relativePath}';`);
	}

	return res.join('');
};

const generateTraitOnMount = ({ acceptPrps }) => {
	const applyDefaults = Object.entries(acceptPrps)
		.filter(([k, v]) => v.dft !== undefined)
		.map(([k, v]) => {
			if (!v.internal) {
				return `
					if (traitPrps.${k} === undefined) {
						traitPrps.${k} = ${JSON.stringify(v.dft, null, '\t')};
					}
				`;
			}

			return `traitPrps.${k} = ${JSON.stringify(v.dft, null, '\t')};`;
		})
		.join('');

	const morphers = Object.entries(acceptPrps)
		.filter(([k, v]) => v.morph === true)
		.map(([k, v]) => {
			const script = buildProps({
				wrap: false,
				prps: v
			});

			let morpher = `
				traitPrps.${k} = getSyncScriptResult({${script}});
			`;

			morpher = morpher.replaceAll('"', '`');

			Object.entries(acceptPrps).forEach(([k, v]) => {
				morpher = morpher.replaceAll(`%${k}%`, `\$\{traitPrps.${k}}`);
			});

			return morpher;
		})
		.join('');

	const res = `
		const setTraitPrps = (traitPrps, setReady) => {
		${applyDefaults}
		${morphers}
		setReady(true);
	};`;

	return res;
};

const dashboard = ({ path, contents }, _mapFiles) => {
	mapFiles = _mapFiles;
	currentPath = path;
	needsHelpers = false;

	const hasMainTrait = !!identifyMainTrait(contents.traits);

	isTrait = contents.acceptPrps !== undefined;
	isFunctionalTrait = isTrait && !contents.type && !hasMainTrait;

	const pathTranspiled = path.replace('.json', '.jsx');

	const outputPath = join('output', 'src', pathTranspiled);

	mkdirSync(dirname(outputPath), { recursive: true });

	usedComponentTypes = [];
	traitImports = [];
	scriptImports = [];

	const rootComponent = generateComponent(contents);

	//generateImports(usedComponentTypes);

	let usePrefix = functionPrefix;
	let useSuffix = functionSuffix;
	if (isTrait) {
		if (!isFunctionalTrait) {
			usePrefix = functionPrefixHasMainTrait;
			useSuffix = functionSuffixHasMainTrait;
		} else {
			usePrefix = functionPrefixFunctionalTrait;
			useSuffix = functionSuffixFunctionalTrait;
		}
	}

	if (hasMainTrait) {
		usePrefix = functionPrefixHasMainTrait;
		useSuffix = functionSuffixHasMainTrait;
	}

	let onMountMethod = '';

	let useMainPrefix = mainPrefix;
	if (isTrait && !isFunctionalTrait) {
		useMainPrefix = mainPrefixHasMainTrait;
		onMountMethod = generateTraitOnMount(contents);
	}

	let transpiled = `
		${useMainPrefix}

		${onMountMethod}

		${generateImports()}

		${usePrefix}
		${rootComponent}
		${useSuffix}
	`;

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default dashboard;
