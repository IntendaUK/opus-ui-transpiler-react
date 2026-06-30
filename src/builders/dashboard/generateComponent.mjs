//Getters / Setters
import { setNeedsHelpers, setNeedsDynamicTypeComponent, setNeedsRenderWgts } from './generateImports.mjs';
import { getIsFunctionalTrait } from './isFunctionalTrait.mjs';
import { getUsedComponentTypes, pushToUsedComponentTypes } from './usedComponentTypes.mjs';
import {
	getDynamicRootTypeInfo,
	registerDynamicRootTypeComponentMap,
	getDynamicTraitFlatCandidates,
	getDynamicTraitFieldCandidates,
	getDynamicTraitFieldNarrowable
} from './dynamicRootTypes.mjs';

//Helpers
import buildProps from './buildProps.mjs';
import buildTraitsInfo from './buildTraitsInfo.mjs';
import buildDynamicTraitMap from './buildDynamicTraitMap.mjs';
import injectTraitPrpsInString from './injectTraitPrpsInString.mjs';
import buildTraitPrpsAccessor from './traitPrpsAccessor.mjs';

//A root COMPONENT trait can also be referenced as a CONFIG trait (e.g. a grid's `traitDataManager`),
// where the consumer merges the trait's CONFIG via applyTraits instead of rendering its JSX. When such
// a root component-trait is generated, we capture a config-only form of its trait application here so
// templates can append it as `Component.traitConfig`. Reset per file via initRootTraitConfig.
let rootTraitConfig;

export const initRootTraitConfig = () => {
	rootTraitConfig = undefined;
};

export const getRootTraitConfig = () => rootTraitConfig;

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

//A dynamic-trait site's KEY expression is a traitPrps accessor (e.g. `traitPrps.traitDataManager`).
// When it is a SIMPLE single-field accessor we can scope the emitted candidate map to just that field's
// statically-discovered options instead of inlining the whole-app flat set into every consuming file.
const SIMPLE_FIELD_ACCESSOR_REGEX = /^\(*\s*traitPrps\.([A-Za-z_$][\w$]*)\s*\)*$/;

const extractDynamicTraitField = expression => {
	if (typeof(expression) !== 'string')
		return;

	const match = expression.match(SIMPLE_FIELD_ACCESSOR_REGEX);

	return match?.[1];
};

//Choose the candidate map for a dynamic-trait KEY expression. If the key is a simple `traitPrps.<field>`
// accessor AND that field is narrowable (every value it can hold was discovered statically — literal
// trait paths plus theme-resolved defaults), emit a field-scoped map holding only that field's options.
// Otherwise (nested/non-simple key, or a field that can carry an unknown runtime value) keep the
// whole-app flat set so a string value sourced from anywhere still resolves.
const buildScopedDynamicTraitMap = expression => {
	const field = extractDynamicTraitField(expression);

	if (field && getDynamicTraitFieldNarrowable(field))
		return buildDynamicTraitMap(field, getDynamicTraitFieldCandidates(field));

	if (field)
		console.warn(`[dynamic-trait] Field "${field}" is not narrowable (can hold a runtime/unresolved value); using the whole-app candidate set.`);

	return buildDynamicTraitMap('array', getDynamicTraitFlatCandidates());
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

	//A dynamic trait reference resolves at runtime in one of two ways: it may ALREADY be a transpiled
	// trait function (a handler/MDA built it as `{ trait: <importedFn> }` — the transpiler rewrites such
	// functional-trait paths into direct imports), in which case it is called directly; otherwise it is
	// a path string looked up in the per-file candidate map.
	const resolveRef = (refExpr, mapName) =>
		`(typeof(${refExpr}) === 'function' ? ${refExpr} : ${mapName}[${refExpr}])`;

	if (trait.isDynamicArray) {
		const mapName = buildScopedDynamicTraitMap(trait.expression);

		const mappedTraits = `(${trait.expression} ?? []).map(trait => {
			const traitRef = trait.trait ?? trait;

			return ${resolveRef('traitRef', mapName)}?.(trait.traitPrps ?? {});
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
		const mapName = buildScopedDynamicTraitMap(trait.expression);

		return wrapCondition(`${resolveRef(trait.expression, mapName)}?.(${buildFunctionalTraitPrps(trait.traitPrps)})`);
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
	else if (typeof(wgts) === 'string' && wgts[0] === '$') {
		//The component's own `wgts` is a dynamic token. Its runtime value can be EITHER pre-rendered
		// React elements (a caller passed static Opus MDA the transpiler turned into JSX — e.g. a modal
		// panel's `wgtsTop: <>…</>`) OR raw Opus MDA built by a script/handler (e.g. an object builder's
		// field widgets, which are `{ id, traits }` objects React rejects as children). renderWgts
		// decides at runtime: elements render as-is, raw MDA goes through wrapWidgets. A bare
		// `{traitPrps.x}` child crashed on the raw-MDA case; blindly wrapping crashed on the JSX case.
		const accessor = buildTraitPrpsAccessor(wgts.replaceAll('$', ''));

		setNeedsRenderWgts(true);

		children = [`{renderWgts(${accessor})}`];
	}

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
		const otherTraitsString = traitsInfo.otherTraits.map(buildTraitApplication).join(',');

		//Capture a config-only form of this root component-trait so it can be reused when the trait is
		// referenced as a CONFIG trait (e.g. a grid's `traitDataManager`). Same prps + otherTraits as the
		// component, but no sysPrps/scope and no JSX wrapper — applyTraits yields the merged config object.
		// Captured here, before prpsString is cleared below.
		if (isRootLevel)
			rootTraitConfig = `(traitPrps = {}, prps = {}) => applyTraits({ prps: {${prpsString}}, traits: [${otherTraitsString}] })`;

		traitsString = `
			{...applyTraits({ sysPrps: {${sysPrpsString}}, prps: {${prpsString}}, traits: [${otherTraitsString}] }) }
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
