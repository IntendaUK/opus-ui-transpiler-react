//Getters / Setters
import { setNeedsHelpers } from './generateImports.mjs';
import { getIsFunctionalTrait } from './isFunctionalTrait.mjs';
import { getUsedComponentTypes, pushToUsedComponentTypes } from './usedComponentTypes.mjs';

//Helpers
import buildProps from './buildProps.mjs';
import buildTraitsInfo from './buildTraitsInfo.mjs';
import injectTraitPrpsInString from './injectTraitPrpsInString.mjs';

//Export
const generateComponent = (obj, isRootLevel = true, isOnlyChild) => {
	let { type, prps, wgts, condition } = obj;

	let componentType;

	const traitsInfo = buildTraitsInfo(obj, { isInRowMda: false });
	const hasFunctionalTraits = traitsInfo?.otherTraits.length > 0;

	if (hasFunctionalTraits)
		setNeedsHelpers(true);

	if (traitsInfo?.mainTrait)
		componentType = traitsInfo.mainTrait.type;
	else {
		if (!type)
			type = 'label';

		componentType = type[0].toUpperCase() + type.substring(1);

		if (!getUsedComponentTypes().includes(type))
			pushToUsedComponentTypes(type);
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
		children = [`{traitPrps.${wgts.replaceAll('$', '')}}`];

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
			if (isRootLevel)
				sysPrps.push(`${key}${s}${bl}['${value}', scope]${br}`);
			else
				sysPrps.push(`${key}${s}'${value}'`);
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
			{...applyTraits({ sysPrps: {${sysPrpsString}}, prps: {${prpsString}}, traits: [${traitsInfo.otherTraits.map(t => `${t.type}(${JSON.stringify(t.traitPrps)})`).join(',')}] }) }
		`;

		sysPrpsString = '';
		prpsString = '';
	}

	if (getIsFunctionalTrait())
		res = `prps: { ${prpsString} }`;
	else {
		const inner = `<${componentType} ${traitsString} ${sysPrpsString} ${mainTraitPrpsString} ${prpsString} ${restString}>${children.join('')}</${componentType}>`;

		if (condition) {
			const conditionString = buildProps({
				prps: condition,
				wrap: false
			});

			res = `isConditionMet({${conditionString}}) ? ${inner} : null`;

			if (!isRootLevel)
				res = `{${res}}`;
		} else
			res = inner;
	}

	return res;
};

export default generateComponent;
