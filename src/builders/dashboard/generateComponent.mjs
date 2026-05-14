//Getters / Setters
import { setNeedsDynamicTraitResolver, setNeedsHelpers } from './generateImports.mjs';
import { getIsFunctionalTrait } from './isFunctionalTrait.mjs';
import { getUsedComponentTypes, pushToUsedComponentTypes } from './usedComponentTypes.mjs';
import { getDynamicRootTypeInfo, registerDynamicRootTypeComponentMap } from './dynamicRootTypes.mjs';

//Helpers
import buildProps from './buildProps.mjs';
import buildTraitsInfo from './buildTraitsInfo.mjs';
import injectTraitPrpsInString from './injectTraitPrpsInString.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';

const containsGeneratedJsx = value => {
	if (typeof(value) === 'string')
		return value.indexOf('<>') === 0;

	if (Array.isArray(value))
		return value.some(containsGeneratedJsx);

	if (typeof(value) === 'object' && value !== null)
		return Object.values(value).some(containsGeneratedJsx);

	return false;
};

const buildFunctionalTraitPrps = traitPrps => {
	if (!containsGeneratedJsx(traitPrps))
		return JSON.stringify(traitPrps);

	return `{${buildProps({
		prps: traitPrps,
		wrap: false
	})}}`;
};

const buildTraitApplication = trait => {
	if (trait.isDynamicArray) {
		setNeedsDynamicTraitResolver(true);

		return `...(${trait.expression} ?? []).map(trait => {
			const traitPath = trait.trait ?? trait;
			return resolveDynamicTrait(traitPath)?.(trait.traitPrps ?? {});
		})`;
	}

	if (trait.isDynamic) {
		setNeedsDynamicTraitResolver(true);

		return `resolveDynamicTrait(${trait.expression})?.(${buildFunctionalTraitPrps(trait.traitPrps)})`;
	}

	return `${trait.type}(${buildFunctionalTraitPrps(trait.traitPrps)})`;
};

//Export
const generateComponent = (obj, isRootLevel = true, isOnlyChild) => {
	let { type, prps, wgts, condition } = obj;

	let componentType;
	let dynamicRootType;

	const traitsInfo = buildTraitsInfo(obj, { isInRowMda: false });
	const hasFunctionalTraits = traitsInfo?.otherTraits.length > 0;

	if (hasFunctionalTraits)
		setNeedsHelpers(true);

	if (traitsInfo?.mainTrait)
		componentType = traitsInfo.mainTrait.type;
	else {
		if (!type)
			type = 'label';

		dynamicRootType = getDynamicRootTypeInfo(type);

		if (dynamicRootType) {
			dynamicRootType.values.forEach(value => {
				if (!getUsedComponentTypes().includes(value))
					pushToUsedComponentTypes(value);
			});

			componentType = 'DynamicRootTypeComponent';
		} else {
			componentType = type[0].toUpperCase() + type.substring(1);

			if (!getUsedComponentTypes().includes(type))
				pushToUsedComponentTypes(type);
		}
	}

	if (type === 'viewport') {
		prps = {
			...prps,
			loadFromJsx: true
		};
	}

	let prpsString = buildProps({
		prps,
		traitsInfo,
		isRootLevel,
		wrap: !getIsFunctionalTrait() && !hasFunctionalTraits
	});

	let mainTraitPrpsString = buildProps({
		prps: traitsInfo?.mainTrait?.traitPrps,
		traitsInfo,
		keyName: 'traitPrps'
	});
	if (traitsInfo?.mainTrait && !mainTraitPrpsString)
		mainTraitPrpsString = 'traitPrps={{}}';

	if (traitsInfo?.mainTrait?.auth)
		mainTraitPrpsString += ` auth={${JSON.stringify(traitsInfo.mainTrait.auth)}}`;

	let children = [];
	if (Array.isArray(wgts))
		children = wgts.map(component => generateComponent(component, false, wgts.length === 1));
	else if (typeof(wgts) === 'string' && wgts[0] === '$')
		children = [`{${buildTraitPrpsAccessor(wgts.replaceAll('$', ''))}}`];

	let res;

	let sysPrps = [];

	['id', 'scope', 'relId', 'container'].forEach(key => {
		const value = obj[key];
		if (!value)
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
			const fixedValue = injectTraitPrpsInString(`"${value}"`);
			if (isRootLevel)
				sysPrps.push(`${key}${s}${bl}[${fixedValue}, scope]${br}`);
			else if (!hasFunctionalTraits && (fixedValue.indexOf('traitPrps') === 0 || fixedValue[0] === '`'))
				sysPrps.push(`${key}${s}{${fixedValue}}`);
			else
				sysPrps.push(`${key}${s}${fixedValue}`);
		} else {
			let fixedValue = injectTraitPrpsInString(`"${value}"`);
			if (!hasFunctionalTraits && (fixedValue.indexOf('traitPrps') === 0 || fixedValue[0] === '`'))
				sysPrps.push(`${key}${s}{${fixedValue}}`);
			else
				sysPrps.push(`${key}${s}${fixedValue}`);
		}
	});
	if (isRootLevel && !obj.scope) {
		if (!hasFunctionalTraits)
			sysPrps.push('scope={scope}');
		else
			sysPrps.push('scope');
	}

	let sysPrpsString = sysPrps.join(hasFunctionalTraits ? ',' : ' ');

	let restString = '';
	if (isRootLevel && !getIsFunctionalTrait())
		restString = '{...rest}';

	let traitsString = '';

	if (hasFunctionalTraits) {
		traitsString = `
			{...applyTraits({ sysPrps: {${sysPrpsString}}, prps: {${prpsString}}, traits: [${traitsInfo.otherTraits.map(buildTraitApplication).join(',')}] }) }
		`;

		sysPrpsString = '';
		prpsString = '';
	}

	if (getIsFunctionalTrait())
		res = `prps: { ${prpsString} }`;
	else {
		let inner = `<${componentType} ${traitsString} ${sysPrpsString} ${mainTraitPrpsString} ${prpsString} ${restString}>${children.join('')}</${componentType}>`;

		if (dynamicRootType) {
			const mapName = registerDynamicRootTypeComponentMap(dynamicRootType.values);
			const typeAccessor = buildTraitPrpsAccessor(dynamicRootType.propName);
			const fallbackType = dynamicRootType.values[0];
			const fallback = fallbackType
				? ` ?? ${mapName}[${JSON.stringify(fallbackType)}]`
				: '';

			inner = `(() => {
				const DynamicRootTypeComponent = ${mapName}[${typeAccessor}]${fallback};

				if (!DynamicRootTypeComponent)
					return null;

				return ${inner};
			})()`;
		}

		if (condition) {
			const conditionString = buildProps({
				prps: condition,
				wrap: false
			});

			res = `isConditionMet({${conditionString}}) ? ${inner} : null`;

			if (!isRootLevel)
				res = `{${res}}`;
		} else if (dynamicRootType && !isRootLevel)
			res = `{${inner}}`;
		else
			res = inner;
	}

	return res;
};

export default generateComponent;
