//Getters / Setters
import { setNeedsDynamicTraitResolver, setNeedsHelpers, setNeedsDynamicTypeComponent } from './generateImports.mjs';
import { getIsFunctionalTrait } from './isFunctionalTrait.mjs';
import { getUsedComponentTypes, pushToUsedComponentTypes } from './usedComponentTypes.mjs';
import { getDynamicRootTypeInfo, registerDynamicRootTypeComponentMap } from './dynamicRootTypes.mjs';

//Helpers
import buildProps from './buildProps.mjs';
import buildTraitsInfo from './buildTraitsInfo.mjs';
import injectTraitPrpsInString from './injectTraitPrpsInString.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';

//A %token%/$token$ used as a component type means the type is resolved at runtime from a trait prop.
const isDynamicTypeToken = value => typeof(value) === 'string' &&
	((value.startsWith('%') && value.endsWith('%')) || (value.startsWith('$') && value.endsWith('$')));

const getDynamicTypeName = token => token.slice(1, -1);

const buildFunctionalTraitPrps = traitPrps => {
	const propsString = buildProps({
		prps: traitPrps,
		wrap: false
	});

	if (!propsString)
		return '{}';

	return `{${propsString}}`;
};

const buildTraitApplication = trait => {
	const wrapCondition = expression => {
		if (!trait.condition)
			return expression;

		const conditionString = buildProps({
			prps: trait.condition,
			wrap: false
		});

		return `isConditionMet({${conditionString}}) ? ${expression} : null`;
	};

	if (trait.isDynamicArray) {
		setNeedsDynamicTraitResolver(true);

		const mappedTraits = `(${trait.expression} ?? []).map(trait => {
			const traitPath = trait.trait ?? trait;
			return resolveDynamicTrait(traitPath)?.(trait.traitPrps ?? {});
		})`;

		if (trait.condition) {
			const conditionString = buildProps({
				prps: trait.condition,
				wrap: false
			});

			return `...(isConditionMet({${conditionString}}) ? ${mappedTraits} : [])`;
		}

		return `...${mappedTraits}`;
	}

	if (trait.isDynamic) {
		setNeedsDynamicTraitResolver(true);

		return wrapCondition(`resolveDynamicTrait(${trait.expression})?.(${buildFunctionalTraitPrps(trait.traitPrps)})`);
	}

	return wrapCondition(`${trait.type}(${buildFunctionalTraitPrps(trait.traitPrps)})`);
};

const buildSysPropValue = value => {
	if (Array.isArray(value))
		return `[${value.map(buildSysPropValue).join(', ')}]`;

	if (typeof(value) !== 'string')
		return JSON.stringify(value);

	return injectTraitPrpsInString(JSON.stringify(value));
};

const needsJsxExpression = value => (
	Array.isArray(value) ||
	typeof(value) !== 'string' ||
	value.indexOf('traitPrps') === 0 ||
	value[0] === '`' ||
	value[0] === '['
);

//Export
const generateComponent = (obj, isRootLevel = true, isOnlyChild, options = {}) => {
	let { type, prps, wgts, condition } = obj;
	const isFunctionalTraitObject = getIsFunctionalTrait() && isRootLevel && !options.forceJsx;

	let componentType;
	let dynamicRootType;
	let dynamicTypeAccessor;

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

		//Only use the static component map when concrete type values were actually discovered from
		// external trait usages; otherwise it would be an empty map that resolves to nothing.
		if (!(dynamicRootType && dynamicRootType.values.length))
			dynamicRootType = undefined;

		if (dynamicRootType) {
			dynamicRootType.values.forEach(value => {
				if (!getUsedComponentTypes().includes(value))
					pushToUsedComponentTypes(value);
			});

			componentType = 'DynamicRootTypeComponent';
		} else if (isDynamicTypeToken(type)) {
			//Type known only at runtime (root with no discoverable values, or any nested token):
			// render through the runtime component registry by the resolved type string.
			dynamicTypeAccessor = buildTraitPrpsAccessor(getDynamicTypeName(type));
			componentType = 'DynamicTypeComponent';

			setNeedsDynamicTypeComponent(true);
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
		wrap: !isFunctionalTraitObject && !hasFunctionalTraits
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
		children = wgts.map(component => generateComponent(component, false, wgts.length === 1, options));
	else if (typeof(wgts) === 'string' && wgts[0] === '$')
		children = [`{${buildTraitPrpsAccessor(wgts.replaceAll('$', ''))}}`];

	let res;

	//Functional trait objects emit a plain object literal (not JSX), so system props
	// like `container` must be rendered as `key: value` entries rather than `key={value}`
	// attributes. Without this they were silently dropped (e.g. a trait's
	// `container: "appDashboard"` portal target never reached the runtime).
	const objectLiteralSysPrps = hasFunctionalTraits || isFunctionalTraitObject;

	let sysPrps = [];

	['id', 'scope', 'relId', 'container'].forEach(key => {
		const value = obj[key];
		if (!value)
			return;

		let bl = '{';
		let br = '}';
		let s = '=';

		if (objectLiteralSysPrps) {
			bl = '';
			br = '';
			s = ':';
		}

		if (key === 'scope') {
			let fixedValue = buildSysPropValue(value);

			//A functional trait has no `scope` parameter to combine with, so skip the
			// root-component scope merge for functional trait objects.
			if (isRootLevel && !isFunctionalTraitObject) {
				if (Array.isArray(value))
					fixedValue = `[${value.map(buildSysPropValue).join(', ')}, scope]`;
				else
					fixedValue = `[${fixedValue}, scope]`;
			}

			if (!objectLiteralSysPrps && (isRootLevel || needsJsxExpression(value) || needsJsxExpression(fixedValue)))
				sysPrps.push(`${key}${s}{${fixedValue}}`);
			else
				sysPrps.push(`${key}${s}${fixedValue}`);
		} else {
			let fixedValue = buildSysPropValue(value);
			if (!objectLiteralSysPrps && needsJsxExpression(fixedValue))
				sysPrps.push(`${key}${s}{${fixedValue}}`);
			else
				sysPrps.push(`${key}${s}${fixedValue}`);
		}
	});
	if (isRootLevel && !obj.scope && !isFunctionalTraitObject) {
		if (!hasFunctionalTraits)
			sysPrps.push('scope={scope}');
		else
			sysPrps.push('scope');
	}

	let sysPrpsString = sysPrps.join(objectLiteralSysPrps ? ',' : ' ');

	let restString = '';
	if (isRootLevel && !isFunctionalTraitObject)
		restString = '{...rest}';

	let traitsString = '';

	if (hasFunctionalTraits && !isFunctionalTraitObject) {
		traitsString = `
			{...applyTraits({ sysPrps: {${sysPrpsString}}, prps: {${prpsString}}, traits: [${traitsInfo.otherTraits.map(buildTraitApplication).join(',')}] }) }
		`;

		sysPrpsString = '';
		prpsString = '';
	}

	if (isFunctionalTraitObject) {
		if (hasFunctionalTraits) {
			const sysPrpsArg = sysPrpsString ? `sysPrps: { ${sysPrpsString} }, ` : '';
			res = `...applyTraits({ ${sysPrpsArg}prps: { ${prpsString} }, traits: [${traitsInfo.otherTraits.map(buildTraitApplication).join(',')}] })`;
		} else {
			const sysPrpsPrefix = sysPrpsString ? `${sysPrpsString}, ` : '';
			res = `${sysPrpsPrefix}prps: { ${prpsString} }`;
		}
	}
	else {
		const dynamicTypeProp = dynamicTypeAccessor ? `type={${dynamicTypeAccessor}}` : '';

		let inner = `<${componentType} ${dynamicTypeProp} ${traitsString} ${sysPrpsString} ${mainTraitPrpsString} ${prpsString} ${restString}>${children.join('')}</${componentType}>`;

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
