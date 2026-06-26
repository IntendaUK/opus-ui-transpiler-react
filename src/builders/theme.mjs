import { outputFolder } from '../config.mjs';
//Imports
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

//Strings
const themePrefix = 'const Theme =';

const themeSuffix = `
	;

	export default Theme;
`;

//A function module is an eval'd `fn` string with `$arg$`/`%arg%` tokens (see scriptRunner's
// getFunctionResult). Emitting it as a real closure lets it close over lexical imports (e.g. trait
// modules the catch-all then converts) instead of resolving trait paths from app.json at runtime.
// Returns the closure source, or null if the body has no clear final expression to return (then we
// leave it as a string — a safe fallback that preserves the old behaviour).
const buildFunctionClosure = (acceptArgs, fnString) => {
	let body = fnString;

	//getFunctionResult passes args as an object keyed by name. Reference them as args.<name> (rather
	// than destructuring) because these bodies typically redeclare `const <name> = $<name>$;`, which
	// would self-reference a destructured param.
	Object.keys(acceptArgs ?? {}).forEach(key => {
		body = body.split(`$${key}$`).join(`args.${key}`).split(`%${key}%`).join(`args.${key}`);
	});

	//The eval'd body yields the value of its trailing expression; a function needs an explicit return.
	const withReturn = body.replace(/(^|[;}])(\s*)([A-Za-z_$][\w$]*)(\s*;\s*)$/, '$1$2return $3$4');

	if (withReturn === body)
		return null;

	return `(args) => { ${withReturn} }`;
};

//Helpers
const generateTheme = theme => {
	const closures = [];

	//Swap each function-module `fn` string for a placeholder during JSON serialization, then splice the
	// real closure source back in (JSON can't hold a function literal).
	const replacer = (key, value) => {
		if (value && typeof(value) === 'object' && !Array.isArray(value) &&
			typeof(value.fn) === 'string' && value.acceptArgs) {
			const closure = buildFunctionClosure(value.acceptArgs, value.fn);

			if (closure) {
				const token = `__FN_CLOSURE_${closures.length}__`;

				closures.push(closure);

				return { ...value, fn: token };
			}
		}

		return value;
	};

	let res = JSON.stringify(theme, replacer, '\t');

	closures.forEach((closure, i) => {
		res = res.replace(`"__FN_CLOSURE_${i}__"`, () => closure);
	});

	return res;
};

const theme = ({ path, contents }) => {
	const transpiled = `
		${themePrefix}
		${generateTheme(contents)}
		${themeSuffix}
	`;

	path = path
		.replace('theme/', 'themes/')
		.replace('.json', '.jsx');

	const outputPath = join(outputFolder, 'src', path);

	mkdirSync(dirname(outputPath), { recursive: true });

	writeFileSync(outputPath, transpiled, 'utf8');
};

export default theme;
