//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Getters / Setters
import { getMapFilesEntry } from './mapFiles.mjs';
import { pushToScriptImports } from './scriptImports.mjs';

//Helpers
import pathToIdentifier from '../pathToIdentifier.mjs';
import identifyMainTrait from './identifyMainTrait.mjs';
import { resolveTraitKey, isComponentTrait } from '../scriptAction.mjs';

//A morph:true acceptPrp can carry an Opus `{{eval. ... }}` expression — a string the runtime eval()s
// at apply time. When that eval references a COMPONENT trait by path, the normal output pass would
// rewrite the path string into a bare module-import identifier; but inside an eval string that import
// is not in scope, so the runtime throws `ReferenceError: <Identifier> is not defined`.
//
// For the narrow, safe case (a single `setVariable` action whose value is a self-contained eval that
// references a component trait and uses NO Opus runtime tokens `{{`/`((`), we lift the eval body into
// a real handler module and call it directly. Real module code can legitimately import the component
// (transformOutputTraitRefs rewrites the `trait: '<path>'` string there), so the reference resolves.
//
// Anything not matching this shape returns null and is left to the existing morph emission unchanged.

//Opus runtime tokens that require context-hoisting (out of scope here). Their presence makes the eval
// body unsafe to lift verbatim, so we bail.
const hasRuntimeTokens = body => body.includes('{{') || body.includes('((');

//Collect every `trait: '<path>'` / `type: '<path>'` whose value begins with @, ./ or ../ (real trait
// references). Single OR double quoted.
const TRAIT_OR_TYPE_REF_REGEX = /\b(?:trait|type)\s*:\s*(["'])((?:@|\.\.?\/)[^"']+)\1/g;

//A morph spec qualifies only when it is a single setVariable action assigning the morph variable an
// eval value. Returns the joined eval string, or null.
const getSingleSetVariableEval = v => {
	if (!Array.isArray(v.morphActions) || v.morphActions.length !== 1)
		return null;

	const [action] = v.morphActions;

	if (
		!action ||
		action.type !== 'setVariable' ||
		action.name !== v.morphVariable ||
		v.morphVariable === undefined
	)
		return null;

	const { value } = action;
	const joined = Array.isArray(value) ? value.join('\n') : value;

	if (typeof(joined) !== 'string')
		return null;

	const trimmed = joined.trim();

	if (!trimmed.startsWith('{{eval.') || !trimmed.endsWith('}}'))
		return null;

	return trimmed;
};

//Does the eval body reference at least one COMPONENT trait (vs. only functional traits)? `currentPath`
// is the trait json's dashboard-relative path, used to resolve relative (./ ../) references.
const referencesComponentTrait = (body, currentPath) => {
	for (const match of body.matchAll(TRAIT_OR_TYPE_REF_REGEX)) {
		const traitPath = match[2];
		const key = resolveTraitKey(traitPath, currentPath);

		if (!key)
			continue;

		const entry = getMapFilesEntry(key);

		if (entry && isComponentTrait(entry.contents))
			return true;
	}

	return false;
};

//Turn the Opus-eval body into real JS:
//  %token% / $token$       -> getDeepProperty(traitPrps, 'token')  (the live value)
//  '{theme.path}' (whole)  -> getThemeValue('path')  (replace the surrounding quotes too)
//  {theme.path} (inline)   -> ${getThemeValue('path')} inside a template, or getThemeValue('path')
//  trait/type: '<path>' left AS-IS (transformOutputTraitRefs rewrites these into imports later).
const transformEvalBody = body => body
	.replace(/%([^%]+)%/g, (_, token) => `getDeepProperty(traitPrps, '${token}')`)
	.replace(/\$([^$]+)\$/g, (_, token) => `getDeepProperty(traitPrps, '${token}')`)
	//A quoted string whose entire content is a single {theme.path} token resolves to the live theme
	// value, so drop the quotes (mirrors buildProps' `"{theme..."` whole-value handling). Done before
	// the generic inline pass so the quotes are removed rather than left wrapping a function call.
	.replace(/(["'])\{theme\.([^}]+)\}\1/g, (_, _quote, path) => `getThemeValue('${path}')`)
	.replace(/\{theme\.([^}]+)\}/g, (_, path) => `getThemeValue('${path}')`);

//Export
//
// `k`    - the acceptPrp name (e.g. 'mdaExtraContainer')
// `v`    - the acceptPrp morph spec
// `path` - the trait json's path as used for output/imports (with .json and the leading `dashboard/`),
//          e.g. 'dashboard/@l2_date_picker/visual/datePickerComponent/index.json'
//
// Returns { callExpression } when it lifted the eval into a handler module (and registered its import),
// or null to leave the existing getSyncScriptResult emission untouched.
const extractEvalTraitHandler = (k, v, path) => {
	const evalString = getSingleSetVariableEval(v);

	if (!evalString)
		return null;

	//Body between the leading `{{eval.` and trailing `}}`.
	const body = evalString.slice('{{eval.'.length, -2);

	if (hasRuntimeTokens(body))
		return null;

	//currentPath as understood by resolveTraitKey / generateImports: dashboard-relative, no extension.
	// `path` already carries the leading `dashboard/`, so use it directly.
	const currentPath = path.replace(/\.json$/, '');

	if (!referencesComponentTrait(body, currentPath))
		return null;

	const dir = dirname(currentPath).split('\\').join('/');
	const importPath = `${dir}/functional/${k}EvalHandler`;
	const handlerId = pathToIdentifier(importPath, { capitalizeFirstSegment: false });

	const transformedBody = transformEvalBody(body);

	const handlerSource = `import { getThemeValue, getDeepProperty } from '@intenda/opus-ui';

const ${handlerId} = (traitPrps) => {
${transformedBody}
	return ${v.morphVariable};
};

export default ${handlerId};
`;

	const outputPath = join('output', 'src', importPath) + '.js';

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, handlerSource, 'utf8');

	pushToScriptImports({
		type: handlerId,
		path: importPath
	});

	return {
		callExpression: `${handlerId}(traitPrps)`
	};
};

export default extractEvalTraitHandler;
