import { outputFolder } from '../config.mjs';
//Imports
import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, extname } from 'path';

import pathToIdentifier from './pathToIdentifier.mjs';

/*
	Post-transpile pass for DATA-FED trait sites — the handful of files whose dynamic-trait reference is
	resolved at runtime from a value carried in data (a repeater row's `contextMenu`, a form's `traits`,
	…). The main transpiler can't narrow these to a field subset (the value isn't a static literal at the
	site), so it falls back to the whole-app `dynamicTraitMap_array` (~2370 entries) in each such file.

	This app is a CLOSED WORLD: a trait reference is always authored as a literal path SOMEWHERE in the
	code (no endpoint ever returns trait paths). So for a given trait "feature" the complete set of values
	a site can receive is exactly the set of literal paths under that feature's folder — collected here by
	the resolved PATH SEGMENT (e.g. `/contextMenu/`), which is immune to data-key renames (the scaffolding
	writes `context_menu`, the site reads `contextMenu`) and to cross-file flow (we scan the whole tree).

	For each configured edge-case file we replace its `dynamicTraitMap_array` with a scoped map holding
	only that feature's entries, drop the imports that the flat map alone pulled in, and assert that every
	collected value resolved to a real module (residual 0 — a non-zero residual is a defect in this pass,
	never a reason to keep the whole-app fallback).
*/

//Verified candidate sets for the grid/input/search data-fed sites. Each list is the COMPLETE set of
//trait paths the site's feeder field can hold (traced from the data builders + app.json column
//configs); every entry is already a member of the whole-app functional-trait flat set, so scoping a
//site to its list is a strict narrowing (never adds an entry, only drops the ~2370 irrelevant ones).
//If a field gains a new trait path, add it here (a residual warning fires if a listed value can't be
//resolved to a real module).
const EXTRA_GRID_COMPONENT_TRAITS = [
	'@l2_dashboards/account_management/pages/token/visual/tokenGrid/visual/exp',
	'@l2_dashboards/reskin/pageDataObject/DOFields/grid/columnTraits/dimensionCellManager',
	'@l2_dashboards/reskin/shared/grid/archivedCell'
];

const HEADER_TRAITS = [
	'@l2_dashboards/reskin/shared/grid/actionHeaderCellEmptyIcon',
	'@l2_grid/visual/headerCells/visual/actionHeaderCell/default/index',
	'@l2_grid/visual/headerCells/visual/actionHeaderCell/reorderRow/index',
	'@l2_grid/visual/headerCells/visual/actionHeaderCell/selectRow/index',
	'@l2_grid/visual/headerCells/visual/headerCell/index',
	'@l2_ontology/reskin/changeLog/visual/grid/visual/statusHeaderCell',
	'@l2_ontology/shared/grid/customActionHeadingCell'
];

const FORM_INPUT_TRAITS = [
	'@l2_dashboards/l2_event_builder/panels/createEditEventPanel/container/functional/dropdownKeyboardNavigation/traits/closeLookupOnEscOrBlur',
	'@l2_dashboards/l2_event_builder/panels/createEditEventPanel/container/functional/dropdownKeyboardNavigation/traits/keyboardNavigator/index',
	'@l2_dashboards/l2_event_builder/panels/createEditEventPanel/container/functional/dropdownKeyboardNavigation/traits/loadLookupValueOnTabAndEnableField',
	'@l2_dashboards/l2_event_builder/panels/createEditEventPanel/container/functional/dropdownKeyboardNavigation/traits/openLookupOnStartTypingOrFocus',
	'@l2_dashboards/l2_menu_adm/manageMenuPanel/form/functional/onMenuIconMount',
	'@l2_dashboards/l2_object_builder/panels/dataObjectFieldsPanel/dataObjectFieldsGrid/createEditFieldPanel/form/functional/fetchLookupData',
	'@l2_dashboards/l2_role_management/createEditRolePanel/form/functional/getRoleInformationFromCode',
	'@l2_dashboards/l2_user_management/createEditUserPanel/form/functional/getUserInformationFromCode',
	'@l2_dashboards/reskin/explorers/systemAdministration/createEditUserPanel/form/functional/loadUserAfterEmailChanged'
];

const SEARCH_OVERLAY_TRAITS = [
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/dataObjects/unionDataObjectMenu',
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/dataObjects/viewDataObjectMenu',
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/dataSources/dataSourceContextMenu',
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/dataSources/dataSourceEntityContextMenu',
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/dataSources/dataSourceNonDiscoverableContextMenu',
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/pendingApproval/requestToPublishDataObjectContextMenu',
	'@l2_dashboards/reskin/explorers/objectLibrary/contextMenu/workspaces/workspaceDataObjectContextMenu',
	'@l2_topbar/visual/search/searchOverlay/functional/openObjectLibraryOnContext',
	'@l2_topbar/visual/search/searchOverlay/functional/setEntryBackgroundColor'
];

//Edge-case files whose data-fed dynamic-trait site falls back to the whole-app trait map. Each is
//scoped to its site's realistic candidate set: `segments` collects every trait under a feature folder
//(the contextMenu case); `values` is an explicit verified list (the grid/input/search cases, whose
//candidates have no single common path segment).
const EDGE_CASES = [
	{
		file: 'dashboard/@l2_dashboards/reskin/explorers/objectLibrary/explorerListItem/index',
		segments: ['/contextMenu/']
	},
	{
		file: 'dashboard/@l2_grid/visual/bodyCells/visual/columnCell/index',
		values: EXTRA_GRID_COMPONENT_TRAITS
	},
	{
		file: 'dashboard/@l2_grid/visual/bodyCells/visual/columnCellNoEdit/index',
		values: EXTRA_GRID_COMPONENT_TRAITS
	},
	{
		file: 'dashboard/@l2_dashboards/reskin/pageDataObject/DOFields/grid/aliasCell',
		values: EXTRA_GRID_COMPONENT_TRAITS
	},
	{
		file: 'dashboard/@l2_grid/visual/headerCells/visual/actionHeaderCell/index',
		values: HEADER_TRAITS
	},
	{
		file: 'dashboard/@l2_inputs/formInput/visual/input/index',
		values: FORM_INPUT_TRAITS
	},
	{
		file: 'dashboard/@l2_inputs/formInputInline/visual/input/index',
		values: FORM_INPUT_TRAITS
	},
	{
		file: 'dashboard/@l2_topbar/visual/search/searchOverlay/index',
		values: SEARCH_OVERLAY_TRAITS
	}
];

const SRC_PREFIX = 'dashboard/';

//Mirror of generateImports' relative-path resolver (kept local; same logic as scriptAction's).
const relativeImportPath = (fromKey, toKey) => {
	const fromParts = fromKey.split('/');
	const toParts = toKey.split('/');

	fromParts.pop();

	let i = 0;
	while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i])
		i++;

	const ups = fromParts.length - i;

	return (ups === 0 ? './' : '../'.repeat(ups)) + toParts.slice(i).join('/');
};

//Collect every literal trait path under one of the feature segments, across the whole output tree, that
// resolves to a real transpiled module. Returns sorted unique mapFiles-style keys ("dashboard/<path>").
const collectFeatureValues = (root, segments) => {
	const values = new Set();
	const literalRegex = /["'](@(?:[^"']*))["']/g;

	const walk = dir => {
		for (const name of readdirSync(dir)) {
			const fullPath = join(dir, name);

			if (statSync(fullPath).isDirectory()) {
				walk(fullPath);

				continue;
			}

			if (!['.js', '.jsx'].includes(extname(name)))
				continue;

			const contents = readFileSync(fullPath, 'utf8');

			let match;
			while ((match = literalRegex.exec(contents))) {
				const value = match[1];

				if (segments.some(segment => value.includes(segment)))
					values.add(value);
			}
		}
	};

	walk(root);

	return [...values].sort();
};

//Does a `@…` value resolve to a transpiled module file in the output? Returns the module info or null.
// Ensemble values (`@scope/…`) live under the output `dashboard/` folder, so resolve against that.
const resolveModule = (root, value) => {
	const jsxPath = join(root, SRC_PREFIX + value + '.jsx');
	const jsPath = join(root, SRC_PREFIX + value + '.js');

	const exists = p => {
		try {
			return statSync(p).isFile();
		} catch {
			return false;
		}
	};

	const file = exists(jsxPath) ? jsxPath : exists(jsPath) ? jsPath : null;

	if (!file)
		return null;

	//A transpiled COMPONENT trait exports `Component.isTranspiledComponent = true` and a `.traitConfig`
	// (its config form). It must be applied via `.traitConfig(prps)`; a FUNCTIONAL trait is called directly.
	const moduleText = readFileSync(file, 'utf8');
	const isComponentTrait = /isTranspiledComponent\s*=\s*true/.test(moduleText) && /\.traitConfig\s*=/.test(moduleText);

	const key = `${SRC_PREFIX}${value}.json`;
	const identifier = pathToIdentifier(key);

	return { value, identifier, isComponentTrait, importTarget: `${SRC_PREFIX}${value}` };
};

//Find the end index of the `{ … }` opened at `openIndex` (the index of `{`), respecting strings/templates.
const matchBrace = (text, openIndex) => {
	let depth = 0;
	let str = null;

	for (let i = openIndex; i < text.length; i++) {
		const ch = text[i];

		if (str) {
			if (ch === '\\') {
				i++;
				continue;
			}

			if (ch === str)
				str = null;

			continue;
		}

		if (ch === '"' || ch === '\'' || ch === '`')
			str = ch;
		else if (ch === '{')
			depth++;
		else if (ch === '}' && --depth === 0)
			return i;
	}

	return -1;
};

//Rewrite a single reader file: swap its whole-app flat map for a feature-scoped one and prune the
// imports the flat map alone pulled in. Pure (contents -> { contents, kept, residual }).
const rewriteReaderFile = (contents, fileKey, root, { segments, values: explicitValues }) => {
	const declStart = contents.indexOf('const dynamicTraitMap_array =');

	if (declStart === -1)
		return { contents, entries: 0, residual: [], skipped: 'no flat map' };

	const braceOpen = contents.indexOf('{', declStart);
	const braceClose = matchBrace(contents, braceOpen);
	const declEnd = contents.indexOf(';', braceClose) + 1;

	//An explicit verified candidate list (grid/input/search sites) is used as-is; a feature-segment
	// case (contextMenu) collects every trait under the segment across the output tree.
	const values = explicitValues
		? [...new Set(explicitValues)].sort()
		: collectFeatureValues(root, segments);
	const modules = [];
	const residual = [];

	for (const value of values) {
		const info = resolveModule(root, value);

		if (info)
			modules.push(info);
		else
			residual.push(value);
	}

	//Build the scoped map body (lazy thunks, so the binding is read at apply time — avoids import-cycle TDZ).
	const entryLines = modules.map(({ value, identifier, isComponentTrait }) =>
		`\t${JSON.stringify(value)}: (prps) => ${identifier}${isComponentTrait ? '.traitConfig' : ''}(prps),`
	);

	const newDecl = `const dynamicTraitMap_array = {\n${entryLines.join('\n')}\n};`;

	let result = contents.slice(0, declStart) + newDecl + contents.slice(declEnd);

	//Ensure each scoped module is imported; collect the identifiers the scoped map now needs.
	const neededImports = new Map(modules.map(({ identifier, importTarget }) =>
		[identifier, relativeImportPath(fileKey, importTarget)]
	));

	//Drop existing trait-map import lines whose identifier is no longer referenced anywhere outside its
	// own import (these are the imports the 2370-entry flat map alone pulled in), then add any missing ones.
	// NOT line-anchored: this pass runs BEFORE the ESLint/prettier format step, and generateImports emits
	// the trait imports concatenated (`res.join('')`) — so all ~2370 are on a single line at this point. An
	// `^…$` (per-line) regex matched none of them, leaving every orphaned import in the output (prettier then
	// split them one-per-line). Matching `import <Ident> from "…";` anywhere catches both forms. It stays
	// specific to single DEFAULT imports, so `import { X } from …` and `import React, { … } from …` (no bare
	// `<Ident> from`) are never touched.
	const importLineRegex = /import\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["'];/g;
	const isReferencedElsewhere = (id, text) => {
		const refs = text.match(new RegExp(`\\b${id}\\b`, 'g')) || [];

		//One reference is the import line itself; >1 means it's used in the body.
		return refs.length > 1;
	};

	result = result.replace(importLineRegex, (line, identifier) => {
		if (neededImports.has(identifier))
			return line;

		return isReferencedElsewhere(identifier, result) ? line : '';
	});

	//Add imports for scoped modules the file doesn't already import.
	const missingImports = [...neededImports.entries()]
		.filter(([identifier]) => !new RegExp(`\\bimport\\s+${identifier}\\b`).test(result))
		.map(([identifier, importPath]) => `import ${identifier} from "${importPath}";`);

	if (missingImports.length)
		result = `${missingImports.join('\n')}\n${result}`;

	return { contents: result, entries: modules.length, residual };
};

const resolveDataFedTraitFields = () => {
	const root = join(outputFolder, 'src');

	for (const { file, segments, values } of EDGE_CASES) {
		const fullPath = join(root, `${file.replace(/^dashboard\//, 'dashboard/')}.jsx`);

		let contents;
		try {
			contents = readFileSync(fullPath, 'utf8');
		} catch {
			//A partial app (e.g. a unit-test fixture) legitimately won't contain this edge-case file.
			continue;
		}

		const { contents: rewritten, entries, residual, skipped } = rewriteReaderFile(contents, file, root, { segments, values });

		if (skipped) {
			console.warn(`[data-fed-trait] ${file}: ${skipped}`);

			continue;
		}

		if (residual.length)
			console.warn(`[data-fed-trait] ${file}: ${residual.length} unresolved value(s) — DEFECT, not a fallback:`, residual);

		writeFileSync(fullPath, rewritten, 'utf8');

		console.log(`[data-fed-trait] ${file}: flat map → ${entries}-entry feature map (residual ${residual.length})`);
	}
};

export { rewriteReaderFile, collectFeatureValues };
export default resolveDataFedTraitFields;
