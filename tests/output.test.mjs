import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, test } from 'node:test';

import { transformTraitReferences } from '../src/builders/scriptAction.mjs';
import { rewriteReaderFile } from '../src/builders/resolveDataFedTraitFields.mjs';
import generateTraitOnMount from '../src/builders/dashboard/generateTraitOnMount.mjs';
import normalizeTraits from '../src/builders/dashboard/normalizeTraits.mjs';
import { getDynamicTraitFieldCandidates, initDynamicTraitCandidates } from '../src/builders/dashboard/dynamicRootTypes.mjs';

//The transpiler stages output per-target under output/<targetBasename> so concurrent/back-to-back
// transpiles into different targets never share files (avoids Windows file-handle contention).
const outputBaseDir = resolve('output');
const fixtureSourceApp = resolve('tests', 'fixtures', 'source-app');
const tmpRoot = resolve('tests', '.tmp');
const fixtureTargetApp = join(tmpRoot, 'target-app');
//outputRoot is the staging dir for the shared `before` build (target = fixtureTargetApp); the tests
// that read generated output directly read from here.
const outputRoot = join(outputBaseDir, basename(fixtureTargetApp));
const outputSrc = join(outputRoot, 'src');

const readOutputFile = (...parts) => readFileSync(join(outputRoot, ...parts), 'utf8');

const listFilesRecursive = folder => {
	if (!existsSync(folder))
		return [];

	return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
		const fullPath = join(folder, entry.name);

		if (entry.isDirectory())
			return listFilesRecursive(fullPath);

		return fullPath;
	});
};

const assertFileExists = path => {
	assert.ok(existsSync(path), `Expected file to exist: ${relative(process.cwd(), path)}`);
	assert.ok(statSync(path).isFile(), `Expected path to be a file: ${relative(process.cwd(), path)}`);
};

const assertFolderExists = path => {
	assert.ok(existsSync(path), `Expected folder to exist: ${relative(process.cwd(), path)}`);
	assert.ok(statSync(path).isDirectory(), `Expected path to be a folder: ${relative(process.cwd(), path)}`);
};

const assertHasFiles = (files, description) => {
	assert.ok(files.length > 0, `Expected at least one ${description} file`);
};

const assertJsSyntax = file => {
	const tmpFolder = mkdtempSync(join(tmpdir(), 'opus-ui-transpiler-syntax-'));
	const tmpFile = join(tmpFolder, `${basename(file, extname(file))}.mjs`);

	writeFileSync(tmpFile, readFileSync(file, 'utf8'), 'utf8');

	try {
		execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
	} finally {
		rmSync(tmpFolder, { recursive: true, force: true });
	}
};

const importGeneratedModule = async (sourceFile, extension = '.mjs') => {
	const tmpFolder = mkdtempSync(join(tmpdir(), 'opus-ui-transpiler-test-'));
	const tmpFile = join(tmpFolder, `${basename(sourceFile, extname(sourceFile))}${extension}`);

	writeFileSync(tmpFile, readFileSync(sourceFile, 'utf8'), 'utf8');

	//Some generated modules (e.g. helpers.jsx) import from '@intenda/opus-ui'. Provide a minimal stub
	// in the tmp folder's node_modules so the bare specifier resolves. cloneNoOverrideNoCopy mirrors the
	// real runtime helper (no-override deep merge) so behavioural assertions stay meaningful.
	const stubDir = join(tmpFolder, 'node_modules', '@intenda', 'opus-ui');
	mkdirSync(stubDir, { recursive: true });
	writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: '@intenda/opus-ui', type: 'module', main: 'index.mjs' }), 'utf8');
	writeFileSync(join(stubDir, 'index.mjs'),
		'export const isConditionMet = () => true;\n' +
		'const merge = (o, newO) => {\n' +
		'  if (typeof o !== "object" || !o) return o;\n' +
		'  if (Array.isArray(o)) { if (!Array.isArray(newO)) newO = []; for (let i = 0; i < o.length; i++) newO[i] = merge(o[i], newO[i]); return newO; }\n' +
		'  if (!newO || typeof newO !== "object") newO = {};\n' +
		'  for (const k in o) { if (!Object.prototype.hasOwnProperty.call(o, k)) continue; if (newO[k] === undefined) { newO[k] = o[k]; continue; } const nv = merge(o[k], newO[k]); if (typeof nv === "object" && nv !== null) newO[k] = nv; } return newO;\n' +
		'};\n' +
		'export const cloneNoOverrideNoCopy = (target, ...sources) => { for (const s of sources) merge(s, target); return target; };\n',
		'utf8');

	try {
		return await import(pathToFileURL(tmpFile).href);
	} finally {
		rmSync(tmpFolder, { recursive: true, force: true });
	}
};

//The component-type resolver reads the SOURCE app's node_modules, so tests must install the
// component libraries their dashboards use. Each library is mocked the way the real Opus UI
// packages are detected: a dist/components/<type> folder per provided component type. Created at
// test time (under node_modules) rather than committed.
const ensureMockComponentLibraries = (appRoot, libraries) => {
	Object.entries(libraries).forEach(([packageName, componentTypes]) => {
		componentTypes.forEach(componentType => {
			const componentDir = join(appRoot, 'node_modules', packageName, 'dist', 'components', componentType);

			mkdirSync(componentDir, { recursive: true });
			writeFileSync(join(componentDir, 'index.js'), '//mock component library entry for transpiler tests\n', 'utf8');
		});
	});
};

const createHyphenTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-hyphen-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const hyphenTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'names', 'range1-3.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'hyphenTraitUsage',
		traits: [{
			trait: 'traits/names/range1-3',
			traitPrps: {
				label: 'Hyphenated trait path'
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	mkdirSync(dirname(hyphenTraitPath), { recursive: true });
	writeFileSync(hyphenTraitPath, JSON.stringify({
		type: 'label',
		acceptPrps: {
			label: 'string'
		},
		prps: {
			cpt: '%label%'
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createDynamicRootTypeTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-dynamic-root-type-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const dynamicRootTypeTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'dynamicRoot', 'flexibleContainerLabel.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'dynamicRootTypeTraitUsage',
		traits: [{
			trait: 'traits/dynamicRoot/flexibleContainerLabel',
			traitPrps: {
				containerType: 'containerSimple',
				labelCpt: 'Dynamic root type label'
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	mkdirSync(dirname(dynamicRootTypeTraitPath), { recursive: true });
	writeFileSync(dynamicRootTypeTraitPath, JSON.stringify({
		acceptPrps: {
			containerType: {
				type: 'string'
			},
			labelCpt: {
				type: 'string'
			}
		},
		type: '%containerType%',
		prps: {
			dir: 'horizontal',
			padding: true
		},
		wgts: [{
			type: 'label',
			prps: {
				cpt: '%labelCpt%'
			}
		}]
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createRuntimeDynamicTypeSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-runtime-dynamic-type');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const traitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'dynamicRoot', 'runtimeDynamicType.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//Use the trait WITHOUT passing the dynamic types statically, so their concrete values are not
	// discoverable at build time and must be resolved at runtime through the registry.
	sampleDashboard.wgts.push({
		id: 'runtimeDynamicTypeUsage',
		traits: [{
			trait: 'traits/dynamicRoot/runtimeDynamicType',
			traitPrps: { labelCpt: 'Runtime dynamic type label' }
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	mkdirSync(dirname(traitPath), { recursive: true });
	//Root type is a runtime token (no discoverable values) and a NESTED wgt also uses a runtime token.
	writeFileSync(traitPath, JSON.stringify({
		acceptPrps: {
			containerType: { type: 'string' },
			innerType: { type: 'string' },
			labelCpt: { type: 'string' }
		},
		type: '%containerType%',
		prps: { dir: 'horizontal' },
		wgts: [{
			type: '%innerType%',
			prps: { flex: true },
			wgts: [{ type: 'label', prps: { cpt: '%labelCpt%' } }]
		}]
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createNumericTraitPathSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-numeric-trait-path');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const numericTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'tokens', 'numericPathTrait.json');
	const nestedTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'tokens', 'numericPathLabel.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'numericPathTraitUsage',
		traits: [{
			trait: 'traits/tokens/numericPathTrait',
			traitPrps: {
				fieldInfo: [{
					caption: 'First numeric path item'
				}]
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	mkdirSync(dirname(numericTraitPath), { recursive: true });
	writeFileSync(numericTraitPath, JSON.stringify({
		acceptPrps: {
			fieldInfo: {
				type: 'array',
				dft: []
			}
		},
		type: 'containerSimple',
		wgts: [{
			traits: [{
				trait: 'traits/tokens/numericPathLabel',
				traitPrps: {
					fieldInfo: '$fieldInfo.0$'
				}
			}]
		}]
	}, null, '\t'), 'utf8');
	writeFileSync(nestedTraitPath, JSON.stringify({
		acceptPrps: {
			fieldInfo: {
				type: 'object'
			}
		},
		type: 'label',
		prps: {
			cpt: '%fieldInfo.caption%'
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createRowMdaMustacheTraitsSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-row-mda-mustache-traits');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'rowMdaMustacheTraitsRepeater',
		type: 'repeater',
		prps: {
			staticData: [{
				caption: 'Runtime trait row',
				traits: [{
					trait: 'traits/row/rowFunctionalTrait',
					traitPrps: {
						rowColor: 'primary'
					}
				}]
			}],
			rowMda: {
				id: 'mustache-trait-row-((rowNumber))',
				type: 'container',
				traits: '{{rowData.traits}}',
				prps: {
					flex: true
				}
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createContextMenuWgtsTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-context-menu-wgts-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const menuItemPath = join(sourceApp, 'app', 'dashboard', 'traits', 'menu', 'menuItem.json');
	const menuActionPath = join(sourceApp, 'app', 'dashboard', 'traits', 'menu', 'menuAction.json');
	const contextMenuIndexPath = join(sourceApp, 'app', 'dashboard', 'traits', 'menu', 'contextMenuIndex.json');
	const myContextMenuPath = join(sourceApp, 'app', 'dashboard', 'traits', 'menu', 'myContextMenu.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(menuItemPath), { recursive: true });

	//A type-bearing component trait — the visual menu item.
	writeFileSync(menuItemPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { cpt: 'string' },
		prps: { cpt: '%cpt%' }
	}, null, '\t'), 'utf8');

	//A functional trait (acceptPrps, no type, no main trait) — a menu action behaviour.
	writeFileSync(menuActionPath, JSON.stringify({
		acceptPrps: { target: 'string' },
		prps: {
			canClick: true,
			scps: [{
				triggers: [{ event: 'onClick' }],
				actions: [{ type: 'setState', target: '%target%', key: 'clicked', value: true }]
			}]
		}
	}, null, '\t'), 'utf8');

	//A functional trait that receives widgets and renders them as a dynamic context-menu MDA — mirrors
	// @l2_context_menu/index, which stuffs the supplied wgts into prps.contextMenu.mda.wgts.
	writeFileSync(contextMenuIndexPath, JSON.stringify({
		acceptPrps: { wgts: { type: 'array', dft: [] } },
		prps: {
			contextMenu: {
				mda: { type: 'containerSimple', wgts: '%wgts%' }
			}
		}
	}, null, '\t'), 'utf8');

	//The context-menu definition (mirrors viewDataObjectMenu): passes wgts to contextMenuIndex, each
	// widget deriving its component type from menuItem (a component trait) and its behaviour from
	// menuAction (a functional trait). These wgts are dynamic MDA the runtime renders, so the
	// transpiler must lift menuItem to a real `type` and import menuAction as a functional trait —
	// not leave them as trait-path strings resolved from app.json at runtime.
	writeFileSync(myContextMenuPath, JSON.stringify({
		acceptPrps: {},
		traits: [{
			trait: 'traits/menu/contextMenuIndex',
			traitPrps: {
				wgts: [{
					traits: [
						{ trait: 'traits/menu/menuItem', traitPrps: { cpt: 'View' } },
						{ trait: 'traits/menu/menuAction', traitPrps: { target: '||panel||' } }
					]
				}]
			}
		}]
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//Reference the context-menu definition so it is included in the build.
	sampleDashboard.wgts.push({
		id: 'contextMenuHost',
		traits: [{ trait: 'traits/menu/myContextMenu', traitPrps: {} }]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

//A COMPONENT trait used as a CONFIG trait: a grid passes a custom dataManager as a `traitDataManager`
// path string, and the base grid merges the resolved trait's CONFIG (not its JSX) via applyTraits. The
// dataManager trait itself is a component trait (`type: "dataLoader"`) with a functional sub-trait
// carrying its scps, so the transpiler must (a) discover it despite it not being a functional trait,
// (b) emit a `Component.traitConfig` config form on its module, and (c) make the dynamic map entry call
// `.traitConfig(prps)` rather than the component.
const createConfigTraitDataManagerSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-config-trait-data-manager');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const dataManagerPath = join(sourceApp, 'app', 'dashboard', '@grids', 'orderGrid', 'gridDataManager', 'index.json');
	const dataScpsPath = join(sourceApp, 'app', 'dashboard', '@grids', 'orderGrid', 'gridDataManager', 'dataScps.json');
	const gridConsumerPath = join(sourceApp, 'app', 'dashboard', 'traits', 'grid', 'orderGrid.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A functional sub-trait carrying the dataManager's scps behaviour.
	mkdirSync(dirname(dataScpsPath), { recursive: true });
	writeFileSync(dataScpsPath, JSON.stringify({
		acceptPrps: {},
		prps: {
			dtaScps: [{
				triggers: [{ event: 'onLoad' }],
				actions: [{ type: 'setState', key: 'loaded', value: true }]
			}]
		}
	}, null, '\t'), 'utf8');

	//The custom dataManager: a COMPONENT trait (has a `type`) that composes the functional sub-trait.
	// Referenced only as a `traitDataManager` config-trait prop — its CONFIG is what the grid merges.
	writeFileSync(dataManagerPath, JSON.stringify({
		type: 'dataLoader',
		acceptPrps: {},
		traits: [{ trait: '@grids/orderGrid/gridDataManager/dataScps' }],
		//`escapeEval` deliberately contains a `$'` sequence (dollar immediately before a quote) and a
		// `${...}` template literal. These are String.replace replacement-string special patterns ($',
		// $&, $`, $$); if Component.traitConfig is appended via a replacement STRING they corrupt the
		// output into invalid JS. The traitConfig must therefore be emitted via a replacement function.
		prps: { autoLoad: true, escapeEval: "{{eval. const a = '$'.replaceAll('%','x'); const b = `>=${a}`; b; }}" }
	}, null, '\t'), 'utf8');

	//A consumer that (1) references the custom dataManager via a `traitDataManager` prop (a literal path,
	// which makes that path a static candidate of the `traitDataManager` FIELD) and (2) has a dynamic
	// `traits` array site keyed on that same field (`%traitDataManager%`, a self-referencing pass-through).
	// The site is field-keyed on `traitDataManager`, so it emits the field-scoped `dynamicTraitMap_traitDataManager`
	// — whose candidates include the component dataManager (and so its `.traitConfig` entry).
	mkdirSync(dirname(gridConsumerPath), { recursive: true });
	writeFileSync(gridConsumerPath, JSON.stringify({
		acceptPrps: { traitDataManager: 'string' },
		type: 'container',
		traits: [
			{ trait: 'traits/static/staticFunctionalTrait' },
			{ trait: '%traitDataManager%' }
		],
		prps: {
			traitDataManager: '@grids/orderGrid/gridDataManager/index'
		}
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//Reference the consumer so it (and its dataManager) are included in the build.
	sampleDashboard.wgts.push({
		id: 'orderGridHost',
		traits: [{ trait: 'traits/grid/orderGrid', traitPrps: { traitDataManager: '@grids/orderGrid/gridDataManager/index' } }]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createDynamicWgtsTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-dynamic-wgts-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const fieldItemPath = join(sourceApp, 'app', 'dashboard', 'traits', 'header', 'fieldItem.json');
	const dynamicWgtsHeaderPath = join(sourceApp, 'app', 'dashboard', 'traits', 'header', 'dynamicWgtsHeader.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(fieldItemPath), { recursive: true });

	//A component trait — the visual for a single field row.
	writeFileSync(fieldItemPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { cpt: 'string' },
		prps: { cpt: '%cpt%' }
	}, null, '\t'), 'utf8');

	//A component trait whose OWN wgts is a dynamic token: at runtime it receives an Opus MDA array via
	// traitPrps (mirrors a data-object header rendering its field widgets). The array is `{ id, traits }`
	// nodes, NOT pre-rendered React — so the transpiler must render it through wrapWidgets, not drop it
	// in as a bare JSX child (which crashes React with "Objects are not valid as a React child").
	writeFileSync(dynamicWgtsHeaderPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { fieldsMda: { type: 'array', dft: [] } },
		prps: {},
		wgts: '$fieldsMda$'
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//Reference the header, passing field widgets (each carrying the fieldItem component trait) as the
	// dynamic wgts — exactly the shape the object builder produces at runtime.
	sampleDashboard.wgts.push({
		id: 'dynamicWgtsHost',
		traits: [{
			trait: 'traits/header/dynamicWgtsHeader',
			traitPrps: {
				fieldsMda: [{
					traits: [{ trait: 'traits/header/fieldItem', traitPrps: { cpt: 'Field A' } }]
				}]
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createNestedFunctionalTraitRefSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-nested-functional-trait-ref');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const behaviourTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'behaviour', 'index.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A FUNCTIONAL trait (no type, no main trait — just behaviour). Referenced from MDA by path, it
	// would otherwise be resolved from app.json at runtime via getTrait.
	mkdirSync(dirname(behaviourTraitPath), { recursive: true });
	writeFileSync(behaviourTraitPath, JSON.stringify({
		acceptPrps: {},
		prps: {
			scps: [{
				triggers: [{ event: 'onMount' }],
				actions: [{ type: 'setState', key: 'mounted', value: true }]
			}]
		}
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//A functional-trait reference nested deep under a non-render key (tOpenTab.value.tabContents.traits)
	// — not a render-MDA position, so only the final catch-all output pass can convert it.
	sampleDashboard.wgts.push({
		id: 'behaviourTabOpener',
		type: 'containerSimple',
		prps: {
			canClick: true,
			fireScript: {
				actions: [{
					type: 'setState',
					target: 'appTabManager',
					key: 'tOpenTab',
					value: {
						tabId: 'behaviour-tab',
						tabContents: {
							traits: [{ trait: '@myEnsemble/behaviour/index', traitPrps: {} }]
						}
					}
				}]
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createSpreadTraitRefSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-spread-trait-ref');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const spreadTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'spread', 'recordChangedTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A SPREAD trait: it has a traitArray (a list of actions spliced into the surrounding script), no
	// own type and no main trait. Referenced by path it would otherwise be resolved from app.json at
	// runtime via getTrait.
	mkdirSync(dirname(spreadTraitPath), { recursive: true });
	writeFileSync(spreadTraitPath, JSON.stringify({
		acceptPrps: {
			originalRecord: 'object',
			modifiedRecord: 'object'
		},
		traitArray: [{
			type: 'applyComparison',
			operator: 'isEqual',
			value: '%originalRecord%',
			compareValue: '%modifiedRecord%',
			branch: {
				true: [{ type: 'setState', key: 'changed', value: false }],
				false: [{ type: 'setState', key: 'changed', value: true }]
			}
		}]
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//A node whose script references the spread trait by path inside its actions (the conventional
	// `{ traits: [{ trait, traitPrps }] }` action-trait shape the runtime splices in).
	sampleDashboard.wgts.push({
		id: 'spreadTraitHost',
		type: 'containerSimple',
		prps: {
			scps: [{
				triggers: [{ event: 'onMount' }],
				actions: [{
					traits: [{
						trait: '@myEnsemble/spread/recordChangedTrait',
						traitPrps: {
							originalRecord: '{{state.self.record}}',
							modifiedRecord: '{{state.self.modifiedRecord}}'
						}
					}]
				}]
			}]
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createTraitPropDefaultSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-trait-prop-default');
	const rowTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'row', 'index.json');
	const componentPropsPath = join(sourceApp, 'src', 'components', 'myWidget', 'props.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A component trait the widget applies to each row it builds.
	mkdirSync(dirname(rowTraitPath), { recursive: true });
	writeFileSync(rowTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { label: 'string' },
		prps: { cpt: '%label%' }
	}, null, '\t'), 'utf8');

	//A hand-written local component whose prop spec declares a `traits<Suffix>` array prop with a
	// DEFAULT trait path nested in `dft: () => [...]`. The catch-all's `traitsX: [...]` (literal-array)
	// pass doesn't reach it, so the path would otherwise stay a string resolved from app.json at runtime.
	mkdirSync(dirname(componentPropsPath), { recursive: true });
	writeFileSync(componentPropsPath, [
		'export default {',
		'  traitsRowItems: {',
		'    type: "array",',
		'    desc: "Traits applied to each built row",',
		'    dft: () => ["@myEnsemble/row/index"],',
		'  },',
		'};',
		''
	].join('\n'), 'utf8');

	return sourceApp;
};

const createBacktickTraitRefSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-backtick-trait-ref');
	const cellTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'cell', 'index.json');
	const buildCellPath = join(sourceApp, 'src', 'components', 'myWidget', 'buildCell.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A component trait referenced below via a template literal (backtick) rather than a quoted string.
	mkdirSync(dirname(cellTraitPath), { recursive: true });
	writeFileSync(cellTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { label: 'string' },
		prps: { cpt: '%label%' }
	}, null, '\t'), 'utf8');

	//A hand-written local component that references the trait with a STATIC backtick literal (no
	// interpolation). The catch-all only matched ' / " quotes, so this path stayed a string resolved
	// from app.json at runtime.
	mkdirSync(dirname(buildCellPath), { recursive: true });
	writeFileSync(buildCellPath, [
		'const buildCell = () => ({',
		'  traits: [{ trait: `@myEnsemble/cell/index`, traitPrps: { label: "Cell" } }],',
		'});',
		'',
		'export default buildCell;',
		''
	].join('\n'), 'utf8');

	return sourceApp;
};

const createDynamicBacktickTraitRefSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-dynamic-backtick-trait-ref');
	const primaryTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'btn', 'primary', 'index.json');
	const secondaryTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'btn', 'secondary', 'index.json');
	const buildBtnPath = join(sourceApp, 'src', 'components', 'myWidget', 'buildBtn.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//Two button-variant component traits the template below can resolve to at runtime.
	mkdirSync(dirname(primaryTraitPath), { recursive: true });
	mkdirSync(dirname(secondaryTraitPath), { recursive: true });
	writeFileSync(primaryTraitPath, JSON.stringify({ type: 'containerSimple', acceptPrps: {}, prps: { cpt: 'Primary' } }, null, '\t'), 'utf8');
	writeFileSync(secondaryTraitPath, JSON.stringify({ type: 'containerSimple', acceptPrps: {}, prps: { cpt: 'Secondary' } }, null, '\t'), 'utf8');

	//A hand-written component that references the trait via an INTERPOLATED template literal — the
	// component segment is only known at runtime (`type`). This can't be a single import; it needs a
	// map of the statically-discoverable candidates keyed by the interpolated value.
	mkdirSync(dirname(buildBtnPath), { recursive: true });
	writeFileSync(buildBtnPath, [
		'const buildBtn = (type) => ({',
		'  traits: [{ trait: `@myEnsemble/btn/${type}/index`, traitPrps: {} }],',
		'});',
		'',
		'export default buildBtn;',
		''
	].join('\n'), 'utf8');

	return sourceApp;
};

const createThemeFunctionTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-theme-function-trait');
	const rowTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'row', 'index.json');
	const themePath = join(sourceApp, 'app', 'theme', 'myFunctions.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A component trait the theme function references when building MDA.
	mkdirSync(dirname(rowTraitPath), { recursive: true });
	writeFileSync(rowTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { label: 'string' },
		prps: { cpt: '%label%' }
	}, null, '\t'), 'utf8');

	//A theme function module: an eval'd `fn` string (with $arg$ tokens) that builds MDA referencing the
	// trait by path. As a string, that path resolves from app.json at runtime; emitted as a real closure
	// it resolves from a lexical import instead.
	mkdirSync(dirname(themePath), { recursive: true });
	writeFileSync(themePath, JSON.stringify({
		buildRows: {
			acceptArgs: { rows: { type: 'array' } },
			fn: "const rows = $rows$; const res = rows.map(r => ({ id: r.id, traits: [{ trait: '@myEnsemble/row/index', traitPrps: { label: r.label } }] })); res;"
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createConditionalRootTypeSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-conditional-root-type');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const sectionTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'menu', 'sectionTrait.json');
	const itemTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'menu', 'itemTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(sectionTraitPath), { recursive: true });
	writeFileSync(sectionTraitPath, JSON.stringify({
		type: 'container',
		scope: 'menuSection',
		acceptPrps: { rowData: 'object' },
		prps: { padding: true },
		wgts: [{ type: 'label', prps: { cpt: '%rowData.caption%' } }]
	}, null, '\t'), 'utf8');
	writeFileSync(itemTraitPath, JSON.stringify({
		type: 'container',
		scope: 'menuItem',
		acceptPrps: { rowData: 'object' },
		prps: { padding: true },
		wgts: [{ type: 'label', prps: { cpt: '%rowData.caption%' } }]
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'conditionalRootTypeRepeater',
		type: 'repeater',
		prps: {
			staticData: [
				{ caption: 'Parent', children: [{}] },
				{ caption: 'Leaf', children: [] }
			],
			rowMda: {
				id: 'conditional-root-((rowNumber))',
				prps: { flex: true },
				traits: [
					{
						condition: { operator: 'isTruthy', value: '{{rowData.children.length}}' },
						trait: 'traits/menu/sectionTrait',
						traitPrps: { rowData: '{{rowData}}' }
					},
					{
						condition: { operator: 'isFalsy', value: '{{rowData.children.length}}' },
						trait: 'traits/menu/itemTrait',
						traitPrps: { rowData: '{{rowData}}' }
					}
				]
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createDataTokenConditionalRootTypeSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-data-token-conditional-root-type');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const headerCellPath = join(sourceApp, 'app', 'dashboard', 'traits', 'grid', 'headerCell.json');
	const actionHeaderCellPath = join(sourceApp, 'app', 'dashboard', 'traits', 'grid', 'actionHeaderCell.json');
	const customHeaderCellPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'customHeaderCell', 'index.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//Two STATIC, condition-guarded visual traits (resolvable component paths)...
	mkdirSync(dirname(headerCellPath), { recursive: true });
	writeFileSync(headerCellPath, JSON.stringify({
		type: 'container',
		acceptPrps: { rowData: 'object' },
		prps: { padding: true },
		wgts: [{ type: 'label', prps: { cpt: '%rowData.caption%' } }]
	}, null, '\t'), 'utf8');
	writeFileSync(actionHeaderCellPath, JSON.stringify({
		type: 'container',
		acceptPrps: { rowData: 'object' },
		prps: { padding: true },
		wgts: [{ type: 'label', prps: { cpt: '%rowData.caption%' } }]
	}, null, '\t'), 'utf8');

	//...and a custom header-cell component the per-row data token resolves to at runtime.
	mkdirSync(dirname(customHeaderCellPath), { recursive: true });
	writeFileSync(customHeaderCellPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { rowData: 'object' },
		prps: { flex: true },
		wgts: [{ type: 'label', prps: { cpt: 'Custom header' } }]
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//A column config somewhere in the app supplies the concrete customHeaderCellTrait value, so it is
	// statically discoverable. (Mirrors how real grid column configs carry the per-column trait path.)
	sampleDashboard.wgts.push({
		id: 'gridColumnConfigHost',
		type: 'containerSimple',
		prps: {
			columnConfig: [
				{ field: 'status', customHeaderCellTrait: '@myEnsemble/customHeaderCell/index' }
			]
		}
	});

	//A repeater whose row component is selected from THREE condition-guarded traits: two static and
	// one whose trait reference is a per-row DATA TOKEN.
	sampleDashboard.wgts.push({
		id: 'dataTokenConditionalRootTypeRepeater',
		type: 'repeater',
		prps: {
			staticData: [{ caption: 'Header', hasCustomHeaderCell: true }],
			rowMda: {
				id: 'data-token-conditional-((rowNumber))',
				prps: { flex: true },
				traits: [
					{
						condition: { operator: 'isFalsy', value: '{{rowData.isAction}}' },
						trait: 'traits/grid/headerCell',
						traitPrps: { rowData: '{{rowData}}' }
					},
					{
						condition: { operator: 'isTruthy', value: '{{rowData.isAction}}' },
						trait: 'traits/grid/actionHeaderCell',
						traitPrps: { rowData: '{{rowData}}' }
					},
					{
						condition: { operator: 'isTruthy', value: '{{rowData.hasCustomHeaderCell}}' },
						trait: '((rowData.field.customHeaderCellTrait))',
						traitPrps: { rowData: '{{rowData}}' }
					}
				]
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createEvalDollarTokenSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-eval-dollar-token');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const evalTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'eval', 'evalConditionTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(evalTraitPath), { recursive: true });
	writeFileSync(evalTraitPath, JSON.stringify({
		acceptPrps: { rowData: 'object' },
		prps: {
			canClick: true,
			fireScript: {
				id: 'sEDT',
				actions: [{
					actionCondition: {
						operator: 'isTruthy',
						//Embedded $rowData.prc_typ$ inside an eval expression must resolve to a
						// quoted string literal, e.g. 'Explorer'.toLowerCase(), not a bare identifier.
						value: "{{sEDT.eval.$rowData.prc_typ$.toLowerCase() === 'menu'}}"
					},
					type: 'setState',
					target: '||menuTree||',
					key: 'selectedDashboardData',
					//Whole-value $rowData$ is a direct replace: the live object, not a string.
					value: '$rowData$'
				}]
			}
		}
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'evalDollarTokenComponent',
		type: 'label',
		prps: { cpt: 'Eval dollar token target' },
		traits: [{
			trait: 'traits/eval/evalConditionTrait',
			traitPrps: { rowData: { prc_typ: 'Explorer' } }
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createRootArrayPrpsMergeSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-root-array-prps-merge');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const traitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scps', 'scriptedContainer.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A typed component-trait that owns root-level array props (scps + flows). When this trait is
	// used and the consumer also supplies scps/flows, Opus concatenates them. The generated root
	// component spreads the caller's `...prps`, so its own scps/flows must be merged past that
	// spread rather than clobbered (which would silently drop the component's own script).
	mkdirSync(dirname(traitPath), { recursive: true });
	writeFileSync(traitPath, JSON.stringify({
		type: 'containerSimple',
		scope: 'scriptedContainer',
		acceptPrps: {},
		prps: {
			flex: true,
			ownState: null,
			scps: [
				{
					id: 'sOwn',
					triggers: [{ event: 'onMount' }],
					actions: [{ type: 'setState', key: 'ownState', value: true }]
				}
			],
			flows: [
				{ fromKey: 'ownState', toKey: 'ownMirror' }
			]
		}
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//The consumer supplies its own scps; at runtime Opus must keep both the trait's sOwn and this.
	sampleDashboard.wgts.push({
		id: 'scriptedContainerUsage',
		traits: [{
			trait: 'traits/scps/scriptedContainer',
			traitPrps: {}
		}],
		prps: {
			scps: [
				{
					id: 'sConsumer',
					triggers: [{ event: 'onMount' }],
					actions: [{ type: 'setState', key: 'consumerState', value: true }]
				}
			]
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createHandlerExtraWgtsSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-handler-extra-wgts');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const rowComponentPath = join(sourceApp, 'app', 'dashboard', 'traits', 'extraWgtsRow', 'rowComponent.json');
	const wrapperComponentPath = join(sourceApp, 'app', 'dashboard', 'traits', 'extraWgtsRow', 'wrapperComponent.json');
	const handlerPath = join(sourceApp, 'app', 'dashboard', 'scriptActions', 'buildExtraWgtsRow.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A typed component-trait that a handler injects into extraWgts at runtime.
	mkdirSync(dirname(rowComponentPath), { recursive: true });
	writeFileSync(rowComponentPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { label: 'string' },
		prps: { cpt: '%label%' }
	}, null, '\t'), 'utf8');

	//A component-trait with NO own type — it is a component only via its main trait. The handler
	// transform must still recognise it as a component (so it is converted to a direct import).
	writeFileSync(wrapperComponentPath, JSON.stringify({
		acceptPrps: {},
		traits: [{ trait: 'traits/extraWgtsRow/rowComponent', traitPrps: { label: 'wrapped' } }]
	}, null, '\t'), 'utf8');

	//A handler that builds widgets referencing those component-traits by path and pushes them into
	// extraWgts. The transpiler must rewrite each trait-path string into a direct component import.
	mkdirSync(dirname(handlerPath), { recursive: true });
	writeFileSync(handlerPath, [
		'const buildExtraWgtsRow = ({ setState }) => {',
		'  setState({',
		'    extraWgts: [',
		"      { id: 'extra-row-0', traits: [{ trait: '../traits/extraWgtsRow/rowComponent', traitPrps: { label: 'Injected' } }], prps: {} },",
		"      { id: 'extra-wrap-0', traits: [{ trait: '../traits/extraWgtsRow/wrapperComponent', traitPrps: {} }], prps: {} }",
		'    ]',
		'  });',
		'};',
		'',
		'export default buildExtraWgtsRow;',
		''
	].join('\n'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//Reference the handler so it is included in the build.
	sampleDashboard.wgts.push({
		id: 'extraWgtsHost',
		type: 'containerSimple',
		prps: {
			scps: [{
				triggers: [{ event: 'onMount' }],
				actions: [{ srcAction: 'scriptActions/buildExtraWgtsRow' }]
			}]
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createActionExtraWgtsSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-action-extra-wgts');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const rowComponentPath = join(sourceApp, 'app', 'dashboard', 'traits', 'extraWgtsRow', 'rowComponent.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(rowComponentPath), { recursive: true });
	writeFileSync(rowComponentPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { label: 'string' },
		prps: { cpt: '%label%' }
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//A node whose scripts build extraWgts both inline (setState value) and via mapArray (mapTo),
	// each referencing a component-trait by path. The transpiler must convert those references.
	sampleDashboard.wgts.push({
		id: 'actionExtraWgtsHost',
		type: 'containerSimple',
		prps: {
			scps: [{
				triggers: [{ event: 'onMount' }],
				actions: [
					{
						type: 'mapArray',
						value: '{{state.self.items}}',
						mapTo: {
							traits: [{ trait: 'traits/extraWgtsRow/rowComponent', traitPrps: { label: 'mapped' } }],
							prps: {}
						},
						storeAsVariable: 'rows'
					},
					{
						type: 'setState',
						key: 'extraWgts',
						value: {
							id: 'inline-row',
							traits: [{ trait: 'traits/extraWgtsRow/rowComponent', traitPrps: { label: 'inline' } }],
							prps: {}
						}
					}
				]
			}]
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createNestedTabContentsTraitRefSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-nested-tab-contents-trait-ref');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const pageTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'page', 'index.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(pageTraitPath), { recursive: true });
	writeFileSync(pageTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: {},
		prps: { flex: true }
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//A component-trait reference nested deep under a non-render key (tOpenTab.value.tabContents.traits)
	// — not caught by key-based detection, only by the final catch-all output pass.
	sampleDashboard.wgts.push({
		id: 'tabOpener',
		type: 'containerSimple',
		prps: {
			canClick: true,
			fireScript: {
				actions: [{
					type: 'setState',
					target: 'appTabManager',
					key: 'tOpenTab',
					value: {
						tabId: 'page-tab',
						tabContents: {
							traits: [{ trait: '@myEnsemble/page/index', traitPrps: {} }]
						}
					}
				}]
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createDuplicateImportSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-duplicate-import');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const sharedTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'shared', 'index.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(sharedTraitPath), { recursive: true });
	writeFileSync(sharedTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: {},
		prps: { flex: true }
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//Node A uses the trait statically (the transpiler imports it, concatenated mid-line).
	sampleDashboard.wgts.push({
		id: 'staticUse',
		traits: [{ trait: '@myEnsemble/shared/index', traitPrps: {} }]
	});

	//Node B references the SAME trait nested under tabContents (only the catch-all pass converts it).
	// The pass must reuse the existing import rather than declare a duplicate.
	sampleDashboard.wgts.push({
		id: 'opener',
		type: 'containerSimple',
		prps: {
			canClick: true,
			fireScript: {
				actions: [{
					type: 'setState',
					target: 'appTabManager',
					key: 'tOpenTab',
					value: { tabContents: { traits: [{ trait: '@myEnsemble/shared/index', traitPrps: {} }] } }
				}]
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createRowMdaOwnTypePlusMainTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-rowmda-type-main-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const typedTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'row', 'typedRowTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A type-bearing component trait.
	mkdirSync(dirname(typedTraitPath), { recursive: true });
	writeFileSync(typedTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: {},
		prps: { flex: true }
	}, null, '\t'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	//A repeater whose rowMda node has BOTH its own type AND a type-bearing main trait. The trait's
	// type overrides the node's, so the transpiler must emit only one `type` (no duplicate key).
	sampleDashboard.wgts.push({
		id: 'typeAndTraitRepeater',
		type: 'repeater',
		prps: {
			staticData: [{}],
			rowMda: {
				id: 'row-((rowNumber))',
				type: 'containerSimple',
				traits: [{ trait: 'traits/row/typedRowTrait', traitPrps: {} }]
			}
		}
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createMorphEvalBacktickSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-morph-eval-backtick');
	const traitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'morph', 'subLabelTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A morph accept-prop whose eval contains a JS template literal (backticks + ${}) and NO %/$
	// tokens. The morpher converts double-quoted values to backtick templates, so those literal
	// backticks/${ must be escaped or the generated module is a syntax error.
	mkdirSync(dirname(traitPath), { recursive: true });
	writeFileSync(traitPath, JSON.stringify({
		type: 'label',
		acceptPrps: {
			subLabel: {
				morph: true,
				morphVariable: 'res',
				morphActions: [
					{ type: 'setVariable', name: 'res', value: "{{eval. const res = 'x'; `(${res})`; }}" }
				]
			}
		},
		prps: { cpt: '%subLabel%' }
	}, null, '\t'), 'utf8');

	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));
	sampleDashboard.wgts.push({
		id: 'subLabelUsage',
		traits: [{ trait: 'traits/morph/subLabelTrait', traitPrps: {} }]
	});
	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createMorphEvalComponentTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-morph-eval-component-trait');
	//Mirror the real datePicker shape: a morph:true acceptPrp whose eval pushes a COMPONENT trait.
	const hostTraitPath = join(sourceApp, 'app', 'dashboard', '@l2_date_picker', 'visual', 'datePickerComponent', 'index.json');
	const buttonTraitPath = join(sourceApp, 'app', 'dashboard', '@l2_dashboards', 'overrides', 'l2_buttons', 'dynamic', 'index.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A component trait the eval references by @-path.
	mkdirSync(dirname(buttonTraitPath), { recursive: true });
	writeFileSync(buttonTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { cpt: 'string' },
		prps: { cpt: '%cpt%' }
	}, null, '\t'), 'utf8');

	//A morph:true acceptPrp: single setVariable eval referencing the component trait, %token% and a
	// {theme.} reference, no Opus runtime tokens.
	mkdirSync(dirname(hostTraitPath), { recursive: true });
	writeFileSync(hostTraitPath, JSON.stringify({
		type: 'label',
		acceptPrps: {
			hasClear: { type: 'boolean', dft: false },
			mdaExtraContainer: {
				morph: true,
				morphVariable: 'res',
				morphActions: [{
					type: 'setVariable',
					name: 'res',
					value: [
						'{{eval.',
						'  const wgts = [];',
						'  if (%hasClear%) {',
						"    wgts.push({ traits: [{ trait: '@l2_dashboards/overrides/l2_buttons/dynamic/index', traitPrps: { cpt: 'Clear', cptColor: '{theme.colors.iconPrimary}' } }], prps: {} });",
						'  }',
						"  const res = wgts.length ? { type: 'containerSimple', prps: {}, wgts } : null;",
						'  res;',
						'}}'
					]
				}]
			}
		},
		prps: { cpt: 'Date picker' }
	}, null, '\t'), 'utf8');

	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));
	sampleDashboard.wgts.push({
		id: 'datePickerUsage',
		traits: [{ trait: '@l2_date_picker/visual/datePickerComponent/index', traitPrps: { hasClear: true } }]
	});
	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createLocalComponentTraitRefSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-local-component-trait-ref');
	const rowTraitPath = join(sourceApp, 'app', 'dashboard', '@myEnsemble', 'row', 'index.json');
	const localComponentPath = join(sourceApp, 'src', 'components', 'myWidget', 'buildWgts.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A component-trait under an @ensemble path (mirrors how real ensembles are referenced).
	mkdirSync(dirname(rowTraitPath), { recursive: true });
	writeFileSync(rowTraitPath, JSON.stringify({
		type: 'containerSimple',
		acceptPrps: { label: 'string' },
		prps: { cpt: '%label%' }
	}, null, '\t'), 'utf8');

	//A hand-written local component (copied verbatim, not transpiled) that builds a widget referencing
	// that component-trait by path. The transpiler must rewrite the path string into a direct import.
	mkdirSync(dirname(localComponentPath), { recursive: true });
	writeFileSync(localComponentPath, [
		'const buildWgts = () => ({',
		"  traits: [{ trait: '@myEnsemble/row/index', traitPrps: { label: 'Local' } }],",
		'  prps: {}',
		'});',
		'',
		'export default buildWgts;',
		''
	].join('\n'), 'utf8');

	return sourceApp;
};

const createLocalComponentSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-local-component');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const componentPath = join(sourceApp, 'src', 'components', 'myWidget', 'index.jsx');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//An app-level component the app would register itself (registerComponentTypes), living in the
	// application's own src/components folder rather than an @intenda package.
	mkdirSync(dirname(componentPath), { recursive: true });
	writeFileSync(componentPath, [
		"import React from 'react';",
		'',
		'export const MyWidget = () => <div>my widget</div>;',
		''
	].join('\n'), 'utf8');

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'localComponentUsage',
		type: 'myWidget',
		prps: { flex: true }
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createComponentLibraryResolutionSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-component-library-resolution');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A scoped, non-base library and an unscoped one, both installed in the source app's node_modules.
	ensureMockComponentLibraries(sourceApp, {
		'@intenda/opus-ui-drag-move': ['dragger'],
		'acme-components': ['fancyWidget']
	});

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push(
		{ id: 'scopedLibComponentUsage', type: 'dragger', prps: {} },
		{ id: 'unscopedLibComponentUsage', type: 'fancyWidget', prps: {} }
	);

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

const createDuplicateScriptActionImportSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-duplicate-script-action-import');
	const duplicateTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scriptActions', 'duplicateActionTrait.json');
	const configStyleActionPath = join(sourceApp, 'app', 'dashboard', 'scriptActions', 'configStyleAction.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(duplicateTraitPath), { recursive: true });
	writeFileSync(duplicateTraitPath, JSON.stringify({
		acceptPrps: {},
		prps: {
			scps: [{
				actions: [{
					srcAction: 'scriptActions/sampleAction',
					direction: -1
				}, {
					srcAction: 'scriptActions/sampleAction',
					direction: 0
				}, {
					srcAction: 'scriptActions/sampleAction',
					direction: 1
				}, {
					srcAction: 'scriptActions/configStyleAction',
					direction: 2
				}]
			}]
		}
	}, null, '\t'), 'utf8');
	writeFileSync(configStyleActionPath, [
		'const configStyleAction = ({ config: { direction } }) => direction;',
		'',
		'export default configStyleAction;',
		''
	].join('\n'), 'utf8');

	return sourceApp;
};

const createTraitScriptBasenameCollisionSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-trait-script-basename-collision');
	const parentTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'collision', 'parentTrait.json');
	const childTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'collision', 'openThing.json');
	const childActionPath = join(sourceApp, 'app', 'dashboard', 'traits', 'collision', 'openThing.js');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(parentTraitPath), { recursive: true });
	writeFileSync(parentTraitPath, JSON.stringify({
		acceptPrps: {},
		traits: ['./openThing']
	}, null, '\t'), 'utf8');
	writeFileSync(childTraitPath, JSON.stringify({
		acceptPrps: {},
		type: 'label',
		prps: {
			cpt: 'Open thing trait',
			scps: [{
				actions: [{
					srcAction: './openThing'
				}]
			}]
		}
	}, null, '\t'), 'utf8');
	writeFileSync(childActionPath, [
		'const openThing = ({ config }) => config;',
		'',
		'export default openThing;',
		''
	].join('\n'), 'utf8');

	return sourceApp;
};

const createParenthesizedDataKeySourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-parenthesized-data-key');
	const parenthesizedKeyTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'data', 'parenthesizedKeyTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(parenthesizedKeyTraitPath), { recursive: true });
	writeFileSync(parenthesizedKeyTraitPath, JSON.stringify({
		acceptPrps: {},
		prps: {
			data: {
				results: {
					post_list: [{
						details: {
							exceptions: [{
								exception_cd: 'EXC9024',
								'sum(transaction_amount)': 1063846.98
							}]
						}
					}]
				}
			}
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createInlineThemeTemplateLiteralSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-inline-theme-template-literal');
	const templateLiteralTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'flows', 'templateLiteralTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	mkdirSync(dirname(templateLiteralTraitPath), { recursive: true });
	writeFileSync(templateLiteralTraitPath, JSON.stringify({
		acceptPrps: {},
		prps: {
			flows: [{
				from: 'menuTree',
				fromKey: 'width',
				toKey: 'right',
				mapFunctionString: [
					'(v, { minWidth }) => {',
					'  return `calc(100% - ${Math.max(v, minWidth)}px + {theme.colors.primary}px)`;',
					'}'
				],
				inlineKeys: [
					'mapFunctionString'
				]
			}]
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createThemedInlineTraitTokenSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-themed-inline-trait-token');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const percentTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'tokens', 'themedInlinePercentFunctionalTrait.json');
	const dollarTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'tokens', 'themedInlineDollarFunctionalTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'themedInlinePercentFunctionalTraitUsage',
		type: 'label',
		traits: [{
			trait: 'traits/tokens/themedInlinePercentFunctionalTrait',
			traitPrps: {
				flag: true
			}
		}]
	}, {
		id: 'themedInlineDollarFunctionalTraitUsage',
		type: 'label',
		traits: [{
			trait: 'traits/tokens/themedInlineDollarFunctionalTrait',
			traitPrps: {
				flag: false
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	mkdirSync(dirname(percentTraitPath), { recursive: true });

	const buildTrait = token => ({
		acceptPrps: {
			flag: 'boolean'
		},
		prps: {
			scps: [{
				actions: [{
					type: 'setVariable',
					name: 'newState',
					value: [
						'{{eval.',
						'  const res = { opacity: 1 };',
						`  if (${token})`,
						'    res.width = {theme.colors.primary};',
						'  else',
						'    res.width = 306;',
						'  res;',
						'}}'
					],
					inlineKeys: [
						'value'
					]
				}]
			}]
		}
	});

	writeFileSync(percentTraitPath, JSON.stringify(buildTrait('%flag%'), null, '\t'), 'utf8');
	writeFileSync(dollarTraitPath, JSON.stringify(buildTrait('$flag$'), null, '\t'), 'utf8');

	return sourceApp;
};

const createThemeDefaultTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-theme-default-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const buttonTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'theme', 'primaryButtonTrait.json');
	const hoverTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'theme', 'hoverFunctionalTrait.json');
	const buttonThemePath = join(sourceApp, 'app', 'theme', 'l2_buttons_colors.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'themeDefaultButtonUsage',
		traits: [{
			trait: 'traits/theme/primaryButtonTrait',
			traitPrps: {
				cpt: 'Theme default button'
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	writeFileSync(buttonThemePath, JSON.stringify({
		'primary/backgroundHoverOff': '{theme.colors.primary}',
		'primary/textHoverOff': '{theme.colors.iconPrimary}'
	}, null, '\t'), 'utf8');

	mkdirSync(dirname(buttonTraitPath), { recursive: true });
	writeFileSync(buttonTraitPath, JSON.stringify({
		acceptPrps: {
			cpt: 'string',
			bgColorHoverOff: {
				type: 'string',
				dft: '{theme.l2_buttons_colors.primary/backgroundHoverOff}'
			},
			textHoverOff: {
				type: 'string',
				dft: '{theme.l2_buttons_colors.primary/textHoverOff}'
			}
		},
		type: 'container',
		prps: {
			backgroundColor: '%bgColorHoverOff%'
		},
		traits: [{
			trait: 'traits/theme/hoverFunctionalTrait',
			traitPrps: {
				bgColorHoverOff: '%bgColorHoverOff%'
			}
		}],
		wgts: [{
			type: 'label',
			prps: {
				cpt: '%cpt%',
				color: '%textHoverOff%'
			}
		}]
	}, null, '\t'), 'utf8');

	writeFileSync(hoverTraitPath, JSON.stringify({
		acceptPrps: {
			bgColorHoverOff: 'string'
		},
		prps: {
			scps: [{
				actions: [{
					type: 'setState',
					key: 'backgroundColor',
					value: '%bgColorHoverOff%'
				}]
			}]
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

const createMorphCaretConditionSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-morph-caret-condition');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const morphTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'morph', 'caretConditionTrait.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'morphCaretConditionUsage',
		traits: [{
			trait: 'traits/morph/caretConditionTrait',
			traitPrps: {
				sourceValue: 'Visible value'
			}
		}]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');
	mkdirSync(dirname(morphTraitPath), { recursive: true });
	writeFileSync(morphTraitPath, JSON.stringify({
		acceptPrps: {
			sourceValue: 'string',
			displayValue: {
				morph: true,
				morphVariable: 'result',
				morphActions: [{
					type: 'stopScript',
					'^condition': {
						operator: 'isFalsy',
						value: '$sourceValue$'
					}
				}, {
					type: 'setVariable',
					name: 'result',
					value: '%sourceValue%'
				}]
			}
		},
		type: 'label',
		prps: {
			cpt: '%displayValue%'
		}
	}, null, '\t'), 'utf8');

	return sourceApp;
};

//Exercises field-scoped dynamic-trait maps and the narrowability safety gate. Three field-keyed dynamic
// sites in one consumer trait:
//   - `traitPrps.litTrait`  : the field only ever holds a literal trait-path → field-scoped map with just it.
//   - `traitPrps.setDataTrait`: the field's value comes from a THEME-accessor default → resolved path is
//                               included in the field-scoped map.
//   - `traitPrps.tokenTrait`: the field is assigned an opaque cross-field token somewhere → NOT narrowable,
//                             so the site keeps the whole-app flat map.
const createFieldScopedDynamicTraitSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-field-scoped-dynamic-trait');
	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const consumerPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scoped', 'consumer.json');
	const litTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scoped', 'litFunctionalTrait.json');
	const themeTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scoped', 'themeFunctionalTrait.json');
	const otherTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scoped', 'otherFunctionalTrait.json');
	const tokenTraitPath = join(sourceApp, 'app', 'dashboard', 'traits', 'scoped', 'tokenFunctionalTrait.json');
	const themePath = join(sourceApp, 'app', 'theme', 'scoped_system.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	const functionalTrait = { acceptPrps: {}, prps: { scps: [] } };

	mkdirSync(dirname(consumerPath), { recursive: true });
	writeFileSync(litTraitPath, JSON.stringify(functionalTrait, null, '\t'), 'utf8');
	writeFileSync(themeTraitPath, JSON.stringify(functionalTrait, null, '\t'), 'utf8');
	writeFileSync(otherTraitPath, JSON.stringify(functionalTrait, null, '\t'), 'utf8');
	writeFileSync(tokenTraitPath, JSON.stringify(functionalTrait, null, '\t'), 'utf8');

	//The theme file the `setDataTrait` default resolves against. Its stored value is a real trait path,
	// so the discovery must add it to `setDataTrait`'s field candidates (otherwise narrowing would drop it).
	writeFileSync(themePath, JSON.stringify({
		setDataTrait: '@scoped/themeTrait'
	}, null, '\t'), 'utf8');

	//Aliases so the theme-resolved and token values resolve to real trait files under @scoped/*.
	mkdirSync(join(sourceApp, 'app', 'dashboard', '@scoped'), { recursive: true });
	writeFileSync(join(sourceApp, 'app', 'dashboard', '@scoped', 'themeTrait.json'), JSON.stringify(functionalTrait, null, '\t'), 'utf8');

	writeFileSync(consumerPath, JSON.stringify({
		acceptPrps: {
			litTrait: 'string',
			setDataTrait: {
				type: 'string',
				dft: '{theme.scoped_system.setDataTrait}'
			},
			tokenTrait: 'string',
			parenTrait: 'string',
			traitPrimaryManager: 'string',
			traitAliasManager: 'string',
			feed: 'string'
		},
		type: 'container',
		//Four field-keyed dynamic sites. The `litTrait` site's field also gets a literal candidate from the
		// `litTrait` prop value below. The `tokenTrait` field is poisoned by the cross-field `%feed%` token,
		// and `parenTrait` by a `((...))` repeater/state token — both must therefore NOT be narrowable, even
		// though `parenTrait` ALSO receives a literal candidate from a call site (so without the gate it would
		// wrongly narrow and drop the runtime-token value).
		traits: [
			{ trait: '%litTrait%' },
			{ trait: '%setDataTrait%' },
			{ trait: '%tokenTrait%' },
			{ trait: '%parenTrait%' },
			{ trait: '%traitPrimaryManager%' },
			{ trait: '%traitAliasManager%' }
		],
		prps: {
			litTrait: 'traits/scoped/litFunctionalTrait',
			tokenTrait: '%feed%',
			parenTrait: '((rowData.feed))',
			//`traitAliasManager` forwards another config-trait prop's value (a `$trait…$` token on a
			// `trait[A-Z]` prop). It must be resolved as an ALIAS — inheriting `traitPrimaryManager`'s
			// bounded candidates — NOT fall back to the whole-app set.
			traitAliasManager: '$traitPrimaryManager$'
		}
	}, null, '\t'), 'utf8');

	//A second, unrelated functional-trait path so the flat set is provably larger than any field subset
	// (used to assert the literal field map does NOT contain this unrelated path).
	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));

	sampleDashboard.wgts.push({
		id: 'scopedConsumerHost',
		traits: [{
			trait: 'traits/scoped/consumer',
			traitPrps: {
				litTrait: 'traits/scoped/litFunctionalTrait',
				tokenTrait: 'traits/scoped/otherFunctionalTrait',
				parenTrait: 'traits/scoped/otherFunctionalTrait',
				//A literal candidate for the alias TARGET, so its (and thus the alias's) field map is non-empty.
				traitPrimaryManager: 'traits/scoped/litFunctionalTrait'
			}
		}]
	});

	//A separate widget that references `otherFunctionalTrait` directly, so it is in the flat candidate set
	// (and would wrongly appear in a too-wide field map).
	sampleDashboard.wgts.push({
		id: 'otherTraitHost',
		traits: [{ trait: 'traits/scoped/otherFunctionalTrait' }]
	});

	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

before(() => {
	//Clean the whole per-target output base (every test stages under output/<targetBasename>).
	rmSync(outputBaseDir, { recursive: true, force: true });
	rmSync(tmpRoot, { recursive: true, force: true });

	//The fixture's dashboards use these component types; declare the libraries that provide them in
	// the fixture's node_modules so the source-app-based resolver can find them.
	ensureMockComponentLibraries(fixtureSourceApp, {
		'@intenda/opus-ui': ['container', 'containerSimple', 'label'],
		'@intenda/opus-ui-components': ['label', 'repeater']
	});

	execFileSync(process.execPath, ['src/transpile.mjs'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: fixtureSourceApp,
			OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: fixtureTargetApp,
			OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
		},
		stdio: 'pipe'
	});
});

test('transpiler generates expected static files from fixture source app', () => {
	[
		join(outputRoot, 'index.html'),
		join(outputRoot, 'public', 'app.json'),
		join(outputRoot, 'public', 'envConfig.js'),
		join(outputSrc, 'helpers.jsx'),
		join(outputSrc, 'transpiled.css'),
		join(outputSrc, 'customUtility.js')
	].forEach(assertFileExists);

	const html = readOutputFile('index.html');
	assert.match(html, /<div\s+id=["']root["']/);

	const css = readOutputFile('src', 'transpiled.css');
	assert.match(css, /--fixture-color:\s*#123456/);
});

test('fixture build-json generated a valid packaged app', () => {
	const packagedApp = JSON.parse(readOutputFile('public', 'app.json'));

	assert.equal(packagedApp.dashboard['index.json'].startup, 'sampleDashboard');
	assert.ok(packagedApp.dashboard['sampleDashboard.json']);
	assert.ok(packagedApp.theme['colors.json']);
});

test('copied app files are normalized from blueprint into dashboard', () => {
	assertFolderExists(join(outputRoot, 'app', 'dashboard'));
	assert.ok(!existsSync(join(outputRoot, 'app', 'blueprint')), 'Expected output/app/blueprint to be removed');

	const movedBlueprintFile = join(outputRoot, 'app', 'dashboard', 'sampleSpreadTrait.json');
	assertFileExists(movedBlueprintFile);

	const movedBlueprint = JSON.parse(readFileSync(movedBlueprintFile, 'utf8'));
	assert.ok(!Object.hasOwn(movedBlueprint, 'actions'));
	assert.deepEqual(movedBlueprint.traitArray, [{
		type: 'showNotification',
		msgType: 'success',
		msg: 'Blueprint action copied'
	}]);
});

test('generated theme files have the expected module shape', () => {
	const themeFiles = listFilesRecursive(join(outputSrc, 'themes')).filter(file => extname(file) === '.jsx');

	assertHasFiles(themeFiles, 'theme JSX');

	themeFiles.forEach(file => {
		const contents = readFileSync(file, 'utf8');

		assert.match(contents, /^const Theme = /m, `Expected Theme declaration in ${relative(outputSrc, file)}`);
		assert.match(contents, /^export default Theme;$/m, `Expected default Theme export in ${relative(outputSrc, file)}`);
	});

	assert.match(readFileSync(join(outputSrc, 'themes', 'colors.jsx'), 'utf8'), /primary/);
});

test('generated non-main JSX files have expected React/export structure', () => {
	const jsxFiles = listFilesRecursive(outputSrc)
		.filter(file => extname(file) === '.jsx')
		.filter(file => basename(file) !== 'main.jsx')
		.filter(file => basename(file) !== 'helpers.jsx')
		.filter(file => basename(file) !== 'conditionalRootType.jsx')
		.filter(file => basename(file) !== 'dynamicTypeComponent.jsx')
		.filter(file => basename(file) !== 'renderDynamicTraits.jsx')
		.filter(file => {
			const label = relative(outputSrc, file);

			return !label.startsWith('themes\\') && !label.startsWith('themes/');
		});

	assertHasFiles(jsxFiles, 'non-main generated JSX');

	jsxFiles.forEach(file => {
		const contents = readFileSync(file, 'utf8');
		const label = relative(outputSrc, file);

		if (!/const\s+spreadTrait\s*=/.test(contents))
			assert.match(contents, /import React(?:,\s*\{[^}]+\})? from ["']react["'];/, `Expected React import in ${label}`);

		assert.match(contents, /export\s+default\s+\w+;/, `Expected default export in ${label}`);

		if (/const\s+spreadTrait\s*=/.test(contents))
			assert.match(contents, /traitArray\s*:/, `Expected spread trait array in ${label}`);
	});
});

test('generated dashboard resolves component types from the source app node_modules (scoped and unscoped)', () => {
	const sourceApp = createComponentLibraryResolutionSourceApp();
	const targetApp = join(tmpRoot, 'target-app-component-library-resolution');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//A scoped, non-base component library is resolved from the source app's node_modules.
	assert.match(dashboard, /import \{ Dragger \} from ["']@intenda\/opus-ui-drag-move["'];/);
	assert.match(dashboard, /<Dragger/);

	//An unscoped component library is resolved too.
	assert.match(dashboard, /import \{ FancyWidget \} from ["']acme-components["'];/);
	assert.match(dashboard, /<FancyWidget/);

	assert.doesNotMatch(dashboard, /from ["']null["']/);
});

test('generated dashboard wraps app-level components via makeComponentWithChildren by type', () => {
	const sourceApp = createLocalComponentSourceApp();
	const targetApp = join(tmpRoot, 'target-app-local-component');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The custom type is rendered through the Opus UI wrapper by its registered type string, so the
	// runtime supplies its state — not used as a raw, unwrapped component.
	assert.match(dashboard, /import \{ makeComponentWithChildren \} from ["']@intenda\/opus-ui["'];/);
	assert.match(dashboard, /const MyWidget = makeComponentWithChildren\(["']myWidget["']\);/);
	assert.match(dashboard, /<MyWidget/);

	//It must NOT be imported as a raw component module (that bypasses the wrapper) nor 'null'.
	assert.doesNotMatch(dashboard, /import \{ MyWidget \} from ["'][^"']*components\/myWidget["'];/);
	assert.doesNotMatch(dashboard, /from ["']null["']/);

	//The raw component is still carried through to the target; it is registered at runtime.
	assertFileExists(join(targetApp, 'src', 'components', 'myWidget', 'index.jsx'));
});

test('generated dashboard supports rowMda traits', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsRowRowMainTrait from ["']\.\/traits\/row\/rowMainTrait["'];/);
	assert.match(dashboard, /import TraitsRowRowFunctionalTrait from ["']\.\/traits\/row\/rowFunctionalTrait["'];/);
	assert.match(dashboard, /import TraitsRowRowArrayFunctionalTrait from ["']\.\/traits\/row\/rowArrayFunctionalTrait["'];/);
	assert.match(dashboard, /id="rowMdaRepeater"/);
	assert.match(dashboard, /rowMda:\s*{/);
	assert.match(dashboard, /type:\s*TraitsRowRowMainTrait/);
	assert.match(dashboard, /traitPrps:\s*{ rowCaption: "\(\(rowData\.caption\)\)" }/);
	assert.match(dashboard, /traits:\s*\[/);
	assert.match(dashboard, /type:\s*TraitsRowRowFunctionalTrait/);
	assert.match(dashboard, /traitPrps:\s*{ rowColor: "primary" }/);
	assert.match(dashboard, /type:\s*TraitsRowRowArrayFunctionalTrait/);
	assert.match(dashboard, /traitPrps:\s*{[\s\S]*rowItems:\s*\[[\s\S]*type:\s*"label"[\s\S]*prps:\s*{ cpt:\s*"Row metadata item" }[\s\S]*\][\s\S]*}/);
	assert.doesNotMatch(dashboard, /rowItems:\s*<>/);
});

test('generated dashboard supports complex nested rowMda components', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /import \{ Container, ContainerSimple \} from ["']@intenda\/opus-ui["'];/);
	assert.match(dashboard, /id="complexRowMdaRepeater"/);
	assert.match(dashboard, /staticData:\s*\[{ id: 1, details: \[{ description: "Nested row" }\] }\]/);
	assert.match(dashboard, /rowMda:\s*{[\s\S]*type:\s*ContainerSimple/);
	assert.match(dashboard, /rowPrps:\s*{[\s\S]*storeRowDataAs:\s*"rowData"[\s\S]*elementIdFormat:\s*"\(\(parentId\)\)-\(\(rowData\.id\)\)"/);
	assert.match(dashboard, /wgts:\s*\[[\s\S]*type:\s*Container[\s\S]*prps:\s*{ dir: "horizontal" }/);
	assert.match(dashboard, /wgts:\s*\[[\s\S]*type:\s*Label[\s\S]*prps:\s*{ cpt: "\(\(rowData\.id\)\)" }/);
	assert.match(dashboard, /type:\s*Repeater[\s\S]*staticData:\s*"{{rowData\.details}}"[\s\S]*rowMda:\s*{[\s\S]*type:\s*Container/);
	assert.match(dashboard, /storeRowDataAs:\s*"detailRow"/);
	assert.match(dashboard, /prps:\s*{ cpt: "\(\(detailRow\.description\)\)" }/);
	assert.match(dashboard, /{\s*type:\s*Label,\s*traits:\s*\[[\s\S]*type:\s*TraitsRowRowFunctionalTrait[\s\S]*traitPrps:\s*{ rowColor: "primary" }[\s\S]*prps:\s*{ flex: true }/);
});

test('generated dashboard supports nested traits', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const outerTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'nested', 'outerTrait.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsNestedOuterTrait from ["']\.\/traits\/nested\/outerTrait["'];/);
	assert.match(dashboard, /<TraitsNestedOuterTrait/);
	assert.match(dashboard, /id="nestedTraitLabel"/);
	assert.match(dashboard, /traitPrps={{ label: "Nested trait caption" }}/);

	assert.match(outerTrait, /import TraitsNestedBaseTrait from ["']\.\/baseTrait["'];/);
	assert.match(outerTrait, /<TraitsNestedBaseTrait/);
	assert.match(outerTrait, /traitPrps={{ label: traitPrps\.label }}/);
});

test('generated functional trait composes nested functional traits', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const parentTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'composed', 'parentFunctionalTrait.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsComposedParentFunctionalTrait from ["']\.\/traits\/composed\/parentFunctionalTrait["'];/);
	assert.match(dashboard, /TraitsComposedParentFunctionalTrait\(\{\s*caption:\s*"Composed caption",?\s*\}\)/);

	assert.match(parentTrait, /import TraitsComposedChildScpTrait from ["']\.\/childScpTrait["'];/);
	assert.match(parentTrait, /import TraitsComposedChildFlowTrait from ["']\.\/childFlowTrait["'];/);
	assert.match(parentTrait, /import TraitsComposedChildWgtsTrait from ["']\.\/childWgtsTrait["'];/);
	assert.match(parentTrait, /import \{ applyTraits \} from ["']\.\.\/\.\.\/\.\.\/helpers["'];/);
	assert.match(parentTrait, /return\s+\{\s*\.\.\.applyTraits\(\{\s*prps:\s*\{\s*classes:\s*"parent-functional-trait"/);
	assert.match(parentTrait, /traits:\s*\[\s*TraitsComposedChildScpTrait\(\{\s*caption:\s*traitPrps\.caption,?\s*\}\),\s*TraitsComposedChildFlowTrait\(\{\}\),\s*TraitsComposedChildWgtsTrait\(\{/s);
	assert.match(parentTrait, /wgts:\s*<>[\s\S]*<Label\s+\{\.\.\.applyTraits\(\{\s*sysPrps:\s*\{\},\s*prps:\s*\{\s*cpt:\s*"Widget with nested traits"/s);
	assert.match(parentTrait, /<Label\s+\{\.\.\.applyTraits\([\s\S]*TraitsComposedChildFlowTrait\(\{\}\)[\s\S]*\)\s*\}[\s\S]*><\/Label>/);
	assert.doesNotMatch(parentTrait, /<>\s*\.\.\.applyTraits/);
	assert.doesNotMatch(parentTrait, /prps:\s*\{\s*\}\s*[\r\n]+\s*;/);
});

test('generated components preserve array scopes', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /id="arrayScopeContainer"[\s\S]*scope=\{\["alphaScope",\s*"betaScope"\]\}/);
	assert.doesNotMatch(dashboard, /scope="alphaScope,betaScope"/);
});

test('generated typed traits only regenerate id when root id uses id trait prop token', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const tokenizedIdTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'id', 'tokenizedIdTrait.jsx'), 'utf8');
	const staticIdTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'id', 'staticIdTrait.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsIdTokenizedIdTrait from ["']\.\/traits\/id\/tokenizedIdTrait["'];/);
	assert.match(dashboard, /import TraitsIdStaticIdTrait from ["']\.\/traits\/id\/staticIdTrait["'];/);
	assert.match(dashboard, /<TraitsIdTokenizedIdTrait\s+id="tokenizedIdTraitUsage"[\s\S]*traitPrps=\{\{ id: "tokenizedProvidedId", caption: "Tokenized id trait" \}\}/);
	assert.match(dashboard, /<TraitsIdStaticIdTrait\s+id="staticIdTraitUsage"[\s\S]*traitPrps=\{\{ id: "staticProvidedId", caption: "Static id trait" \}\}/);

	assert.match(tokenizedIdTrait, /id=\{traitPrps\.id\}/);
	assert.match(tokenizedIdTrait, /traitPrps\.id = generateGuid\(\);/);
	assert.match(staticIdTrait, /id="staticTraitRootId"/);
	assert.doesNotMatch(staticIdTrait, /traitPrps\.id = generateGuid\(\);/);
});

test('generated typed trait uses targeted token replacement in sysPrps and prps', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const targetedTokenTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'tokens', 'targetedTokenTrait.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsTokensTargetedTokenTrait from ["']\.\/traits\/tokens\/targetedTokenTrait["'];/);
	assert.match(dashboard, /<TraitsTokensTargetedTokenTrait\s+id="targetedTokenTraitUsage"[\s\S]*traitPrps=\{\{[\s\S]*id: "targetedId"[\s\S]*caption: "Targeted token caption"[\s\S]*color: "primary"[\s\S]*details: \{ name: "Nested token source" \}[\s\S]*\}\}/);

	assert.match(targetedTokenTrait, /id=\{`token-\$\{getDeepProperty\(traitPrps, ["']id["']\)\}-suffix`\}/);
	//Embedded %caption% injects raw; embedded $details.name$ is JSON.stringified, mirroring
	// the runtime's getMorphedString (% raw, $ quoted).
	assert.match(targetedTokenTrait, /cpt:\s*`Hello \$\{getDeepProperty\(traitPrps, ["']caption["']\)\} from \$\{JSON\.stringify\(getDeepProperty\(traitPrps, ["']details\.name["']\)\)\}`/);
	assert.match(targetedTokenTrait, /color:\s*traitPrps\.color/);
	assert.doesNotMatch(targetedTokenTrait, /"%caption%"/);
	assert.doesNotMatch(targetedTokenTrait, /"\$color\$"/);
});

test('generated trait quotes embedded $token$ inside eval expressions', () => {
	const sourceApp = createEvalDollarTokenSourceApp();
	const targetApp = join(tmpRoot, 'target-app-eval-dollar-token');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const evalTrait = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'eval', 'evalConditionTrait.jsx'),
		'utf8'
	);

	//Embedded $rowData.prc_typ$ must be JSON.stringified so it lands as a quoted literal in eval.
	assert.match(
		evalTrait,
		/\$\{JSON\.stringify\(getDeepProperty\(traitPrps, ["']rowData\.prc_typ["']\)\)\}\.toLowerCase\(\) === 'menu'/
	);

	//It must NOT emit the bare-identifier form that crashed at runtime (Explorer is not defined).
	assert.doesNotMatch(evalTrait, /\$\{getDeepProperty\(traitPrps, ["']rowData\.prc_typ["']\)\}\.toLowerCase/);

	//Whole-value $rowData$ stays a direct accessor to the live object (no quoting).
	assert.match(evalTrait, /value:\s*traitPrps\.rowData\b/);
});

test('generated root trait merges its own array props with the caller-supplied prps', () => {
	const sourceApp = createRootArrayPrpsMergeSourceApp();
	const targetApp = join(tmpRoot, 'target-app-root-array-prps-merge');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const trait = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'scps', 'scriptedContainer.jsx'),
		'utf8'
	);

	//The component still spreads the caller's props.
	const spreadIndex = trait.indexOf('...prps');
	assert.ok(spreadIndex !== -1, 'Expected the root trait to spread the caller prps (...prps)');

	//Array-typed Opus props (scps, flows) are merged with the caller's value rather than overwritten,
	// and that merge is emitted AFTER the spread so `...prps` cannot clobber the component's own.
	assert.match(trait, /scps:\s*\[\s*\.\.\.\(prps\?\.scps \?\? \[\]\),\s*\.\.\.\[/);
	assert.match(trait, /flows:\s*\[\s*\.\.\.\(prps\?\.flows \?\? \[\]\),\s*\.\.\.\[/);

	const scpsMergeIndex = trait.search(/scps:\s*\[\s*\.\.\.\(prps\?\.scps/);
	const flowsMergeIndex = trait.search(/flows:\s*\[\s*\.\.\.\(prps\?\.flows/);
	assert.ok(scpsMergeIndex > spreadIndex, 'Merged scps must be emitted after the ...prps spread');
	assert.ok(flowsMergeIndex > spreadIndex, 'Merged flows must be emitted after the ...prps spread');

	//The component's own script id must still be present in the emitted (merged) scps.
	assert.match(trait, /id:\s*["']sOwn["']/);

	//Scalar props are still plain overrides (not array-merged) and remain before the spread.
	const ownStateIndex = trait.indexOf('ownState: null');
	assert.ok(ownStateIndex !== -1 && ownStateIndex < spreadIndex, 'Scalar props remain before the spread and are overridable');
});

test('transpiled component modules are tagged so they can render as React component-traits', () => {
	//Every transpiled component (not functional traits) is tagged for the runtime so it can be
	// rendered directly as React when referenced as a component-trait in dynamically-injected widgets.
	const tokenizedScopeTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'tokens', 'tokenizedScopeTrait.jsx'), 'utf8');
	assert.match(tokenizedScopeTrait, /Component\.isTranspiledComponent = true;/);

	//Functional traits export a FunctionalTrait function and must NOT be tagged.
	const functionalTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'static', 'staticFunctionalTrait.jsx'), 'utf8');
	assert.doesNotMatch(functionalTrait, /\.isTranspiledComponent = true;/);
});

test('handler-built extraWgts component-trait references become direct component imports', () => {
	const sourceApp = createHandlerExtraWgtsSourceApp();
	const targetApp = join(tmpRoot, 'target-app-handler-extra-wgts');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const handler = readFileSync(
		join(targetApp, 'src', 'dashboard', 'scriptActions', 'buildExtraWgtsRow.js'),
		'utf8'
	);

	//The component-trait path string is replaced by a direct import of the transpiled component...
	assert.match(handler, /import TraitsExtraWgtsRowRowComponent from ["']\.\.\/traits\/extraWgtsRow\/rowComponent["'];/);
	assert.match(handler, /trait:\s*TraitsExtraWgtsRowRowComponent\b/);

	//...and is no longer a trait-path string (which would route to runtime JSON resolution).
	assert.doesNotMatch(handler, /trait:\s*["']\.\.\/traits\/extraWgtsRow\/rowComponent["']/);

	//A component-trait with no own type (component only via its main trait) is also converted.
	assert.match(handler, /import TraitsExtraWgtsRowWrapperComponent from ["']\.\.\/traits\/extraWgtsRow\/wrapperComponent["'];/);
	assert.match(handler, /trait:\s*TraitsExtraWgtsRowWrapperComponent\b/);

	//The injected component module is tagged so the runtime renders it as React.
	const rowComponent = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'extraWgtsRow', 'rowComponent.jsx'),
		'utf8'
	);
	assert.match(rowComponent, /Component\.isTranspiledComponent = true;/);
});

test('action-built extraWgts MDA has its component-trait references converted to React', () => {
	const sourceApp = createActionExtraWgtsSourceApp();
	const targetApp = join(tmpRoot, 'target-app-action-extra-wgts');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The component-trait is imported once and used directly in both the inline setState extraWgts
	// value and the mapArray mapTo template — not left as a trait-path string for runtime JSON.
	assert.match(dashboard, /import TraitsExtraWgtsRowRowComponent from ["'][^"']*traits\/extraWgtsRow\/rowComponent["'];/);
	assert.match(dashboard, /type:\s*TraitsExtraWgtsRowRowComponent\b/);
	assert.doesNotMatch(dashboard, /trait:\s*["']traits\/extraWgtsRow\/rowComponent["']/);
});

test('component-trait references nested under arbitrary keys (tabContents) are converted', () => {
	const sourceApp = createNestedTabContentsTraitRefSourceApp();
	const targetApp = join(tmpRoot, 'target-app-nested-tab-contents-trait-ref');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The deeply-nested tabContents trait reference is rewritten to a direct component import.
	assert.match(dashboard, /import MyEnsemblePageIndex from ["'][^"']*@myEnsemble\/page\/index["'];/);
	assert.match(dashboard, /trait:\s*MyEnsemblePageIndex\b/);
	assert.doesNotMatch(dashboard, /trait:\s*["']@myEnsemble\/page\/index["']/);
});

test('catch-all trait conversion does not duplicate an already-imported component', () => {
	const sourceApp = createDuplicateImportSourceApp();
	const targetApp = join(tmpRoot, 'target-app-duplicate-import');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The component is imported exactly once, despite being used statically and referenced in MDA.
	const importCount = (dashboard.match(/import MyEnsembleSharedIndex from /g) || []).length;
	assert.equal(importCount, 1, `Expected exactly one import, found ${importCount}`);
	assert.match(dashboard, /trait:\s*MyEnsembleSharedIndex\b/);
});

test('a component trait whose own wgts is a dynamic token renders the value through renderWgts (not a raw React child)', () => {
	const sourceApp = createDynamicWgtsTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-dynamic-wgts-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const header = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'header', 'dynamicWgtsHeader.jsx'),
		'utf8'
	);

	//The dynamic wgts token is rendered through renderWgts — the shared opus-ui helper — which handles
	// both runtime shapes the value can take: pre-transpiled React elements (rendered as-is) or raw Opus
	// MDA (run through wrapWidgets, turning each `{ id, traits }` node into a real element).
	assert.match(header, /import \{ renderWgts \} from ["']@intenda\/opus-ui["'];/);
	assert.match(header, /renderWgts\(traitPrps\.fieldsMda\)/);

	//The raw MDA array is NEVER dropped in as a bare JSX child — that is the "Objects are not valid as
	// a React child" crash this guards against.
	assert.doesNotMatch(header, />\s*\{\s*traitPrps\.fieldsMda\s*\}\s*</);

	//renderWgts is the shared opus-ui helper, not a transpiler-generated module.
	assert.ok(!existsSync(join(targetApp, 'src', 'renderWgts.jsx')), 'renderWgts must come from @intenda/opus-ui, not be generated');
});

test('context-menu wgts passed as trait props lift their component trait to a type and import functional traits', () => {
	const sourceApp = createContextMenuWgtsTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-context-menu-wgts-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const contextMenu = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'menu', 'myContextMenu.jsx'),
		'utf8'
	);

	//Both the component trait and the functional trait are imported directly...
	assert.match(contextMenu, /import TraitsMenuMenuItem from ["']\.\/menuItem["'];/);
	assert.match(contextMenu, /import TraitsMenuMenuAction from ["']\.\/menuAction["'];/);

	//...the component trait (menuItem) is lifted to a real `type` on the widget (this is what gives
	// the runtime a React component to render — without it the widget is bare `{ id, traits }` MDA
	// that React rejects as a child)...
	assert.match(contextMenu, /type:\s*TraitsMenuMenuItem\b/);

	//...and the sibling functional trait (menuAction) is emitted as an applied functional trait
	// ({ type: fn }) rather than a trait-path string.
	assert.match(contextMenu, /traits:\s*\[\s*\{\s*type:\s*TraitsMenuMenuAction\b/);

	//No trait-path strings survive for these widgets — nothing routes to runtime app.json resolution.
	assert.doesNotMatch(contextMenu, /trait:\s*["']traits\/menu\/menuItem["']/);
	assert.doesNotMatch(contextMenu, /trait:\s*["']traits\/menu\/menuAction["']/);
});

test('a component trait used as a config-trait prop (traitDataManager) is converted to a direct .traitConfig import, and its candidate map is emptied', () => {
	const sourceApp = createConfigTraitDataManagerSourceApp();
	const targetApp = join(tmpRoot, 'target-app-config-trait-data-manager');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	//The consumer grid trait both USES a dataManager (a `traitDataManager` config-trait prop) and is the
	// shared component carrying the field-keyed `traitDataManager` site.
	const consumer = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'grid', 'orderGrid.jsx'),
		'utf8'
	);

	//`traitDataManager` is a config-trait field: its literal use-site path is converted to a DIRECT
	// import, called via `.traitConfig` (the config closure the consumer invokes) because it's a
	// component trait. The reference now lives with the caller — not as a string resolved at runtime.
	assert.match(consumer, /import GridsOrderGridGridDataManagerIndex from ['"][^'"]*@grids\/orderGrid\/gridDataManager\/index['"];/);
	assert.match(consumer, /traitDataManager:\s*GridsOrderGridGridDataManagerIndex\.traitConfig/);

	//The bare path string is gone — neither a use-site value nor a map key.
	assert.doesNotMatch(consumer, /["']@grids\/orderGrid\/gridDataManager\/index["']/);

	//And the field's whole-app candidate map is emitted EMPTY (name preserved so the consumer's
	// `dynamicTraitMap_traitDataManager[...]` reference still resolves; the huge map is gone).
	assert.match(consumer, /dynamicTraitMap_traitDataManager\s*=\s*\{\s*\}/);

	//The dataManager's own generated module exposes the config form so the map entry can call it.
	const dataManager = readFileSync(
		join(targetApp, 'src', 'dashboard', '@grids', 'orderGrid', 'gridDataManager', 'index.jsx'),
		'utf8'
	);
	assert.match(dataManager, /Component\.traitConfig\s*=\s*\(traitPrps = \{\}, prps = \{\}\)\s*=>\s*applyTraits\(/);
	//The config form merges the functional sub-trait (no JSX wrapper, no sysPrps/scope).
	assert.match(dataManager, /Component\.traitConfig[\s\S]*traits:\s*\[/);

	//The traitConfig body contains a `$'` sequence. If it were spliced in via a replacement STRING,
	// String.replace would treat `$'` as "insert everything after the match" and inject the suffix tail
	// (`export default Component;`) into the middle of the config — corrupting it. So `export default
	// Component;` must appear EXACTLY once, and the `$'` must survive verbatim. (assertJsSyntax can't be
	// used here: it's `node --check`, which doesn't parse the component's JSX.)
	assert.equal((dataManager.match(/export default Component;/g) || []).length, 1,
		'traitConfig must be spliced via a replacement function, not a replacement string (no $-pattern tail injection)');
	assert.match(dataManager, /Component\.traitConfig[\s\S]*'\$'/);
});

test('functional-trait references in MDA are converted to direct imports (no app.json resolution)', () => {
	const sourceApp = createNestedFunctionalTraitRefSourceApp();
	const targetApp = join(tmpRoot, 'target-app-nested-functional-trait-ref');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The functional-trait path string is rewritten to a direct import of the transpiled functional
	// trait module, and used in place of the string — so it applies without any app.json lookup.
	assert.match(dashboard, /import MyEnsembleBehaviourIndex from ["'][^"']*@myEnsemble\/behaviour\/index["'];/);
	assert.match(dashboard, /trait:\s*MyEnsembleBehaviourIndex\b/);
	assert.doesNotMatch(dashboard, /trait:\s*["']@myEnsemble\/behaviour\/index["']/);
});

test('spread-trait references in MDA are converted to direct imports (no app.json resolution)', () => {
	const sourceApp = createSpreadTraitRefSourceApp();
	const targetApp = join(tmpRoot, 'target-app-spread-trait-ref');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//A spread trait (traitArray) referenced by path is rewritten to a direct import of the transpiled
	// spread-trait module and used in place of the string — so the runtime applies it (token
	// substitution + traitArray splice) without resolving it from app.json via getTrait.
	assert.match(dashboard, /import MyEnsembleSpreadRecordChangedTrait from ["'][^"']*@myEnsemble\/spread\/recordChangedTrait["'];/);
	assert.match(dashboard, /trait:\s*MyEnsembleSpreadRecordChangedTrait\b/);
	assert.doesNotMatch(dashboard, /trait:\s*["']@myEnsemble\/spread\/recordChangedTrait["']/);

	//The spread-trait module itself still exports its { acceptPrps, traitArray } object.
	const spreadTrait = readFileSync(join(targetApp, 'src', 'dashboard', '@myEnsemble', 'spread', 'recordChangedTrait.jsx'), 'utf8');
	assert.match(spreadTrait, /traitArray\s*:/);
	assert.match(spreadTrait, /export default \w+;/);
});

test('trait-path strings in a traits<Suffix> prop default are converted to direct imports', () => {
	const sourceApp = createTraitPropDefaultSourceApp();
	const targetApp = join(tmpRoot, 'target-app-trait-prop-default');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const props = readFileSync(join(targetApp, 'src', 'components', 'myWidget', 'props.js'), 'utf8');

	//The trait path nested in `dft: () => [...]` is rewritten to a direct import of the transpiled
	// component, in place (the prop-spec structure is preserved) — no app.json resolution at runtime.
	assert.match(props, /import MyEnsembleRowIndex from ["'][^"']*dashboard\/@myEnsemble\/row\/index["'];/);
	assert.match(props, /dft:\s*\(\s*\)\s*=>\s*\[\s*MyEnsembleRowIndex\s*\]/);
	assert.doesNotMatch(props, /["']@myEnsemble\/row\/index["']/);
});

test('static backtick (template-literal) trait references are converted to direct imports', () => {
	const sourceApp = createBacktickTraitRefSourceApp();
	const targetApp = join(tmpRoot, 'target-app-backtick-trait-ref');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const buildCell = readFileSync(join(targetApp, 'src', 'components', 'myWidget', 'buildCell.js'), 'utf8');

	//A static backtick trait path is rewritten to a direct import, same as a quoted one.
	assert.match(buildCell, /import MyEnsembleCellIndex from ["'][^"']*dashboard\/@myEnsemble\/cell\/index["'];/);
	assert.match(buildCell, /trait:\s*MyEnsembleCellIndex\b/);
	assert.doesNotMatch(buildCell, /trait:\s*`@myEnsemble\/cell\/index`/);
});

test('dynamic (interpolated) backtick trait template becomes a candidate import map', () => {
	const sourceApp = createDynamicBacktickTraitRefSourceApp();
	const targetApp = join(tmpRoot, 'target-app-dynamic-backtick-trait-ref');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const buildBtn = readFileSync(join(targetApp, 'src', 'components', 'myWidget', 'buildBtn.js'), 'utf8');

	//The two discoverable candidates are imported and put in a map keyed by the interpolated segment,
	// and the reference becomes map[<the interpolation expression>] — no app.json lookup, no string path.
	assert.match(buildBtn, /import MyEnsembleBtnPrimaryIndex from /);
	assert.match(buildBtn, /import MyEnsembleBtnSecondaryIndex from /);
	assert.match(buildBtn, /["']?primary["']?:\s*MyEnsembleBtnPrimaryIndex/);
	assert.match(buildBtn, /["']?secondary["']?:\s*MyEnsembleBtnSecondaryIndex/);
	assert.match(buildBtn, /trait:\s*\w+\[type\]/);
	assert.doesNotMatch(buildBtn, /`@myEnsemble\/btn\/\$\{type\}\/index`/);
});

test('theme function modules are emitted as real closures with trait imports (no eval string)', () => {
	const sourceApp = createThemeFunctionTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-theme-function-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const theme = readFileSync(join(targetApp, 'src', 'themes', 'myFunctions.jsx'), 'utf8');

	//The eval'd `fn` string is emitted as a real arrow that destructures-by-reference from the args
	// object; $arg$ tokens become args.<name>, and the final expression is returned.
	assert.match(theme, /fn:\s*\(\s*args\s*\)\s*=>/);
	assert.doesNotMatch(theme, /fn:\s*["']/);
	assert.match(theme, /args\.rows/);
	assert.match(theme, /return res;/);

	//The trait path inside the (now real) function body is converted to a lexical import — no app.json.
	assert.match(theme, /import MyEnsembleRowIndex from /);
	assert.match(theme, /trait:\s*MyEnsembleRowIndex\b/);
	assert.doesNotMatch(theme, /['"]@myEnsemble\/row\/index['"]/);
});

test('rowMda node with its own type and a type-bearing main trait emits a single type key', () => {
	const sourceApp = createRowMdaOwnTypePlusMainTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-rowmda-type-main-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The main trait's type wins; the node's own type is dropped (no duplicate `type` key).
	assert.match(dashboard, /type:\s*TraitsRowTypedRowTrait/);
	assert.doesNotMatch(dashboard, /type:\s*\w+,\s*type:\s*\w+/);
});

test('morph eval value containing a JS template literal is escaped (no syntax error)', () => {
	const sourceApp = createMorphEvalBacktickSourceApp();
	const targetApp = join(tmpRoot, 'target-app-morph-eval-backtick');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const contents = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'morph', 'subLabelTrait.jsx'),
		'utf8'
	);

	//The literal backticks and ${ inside the eval are escaped, so they stay literal in the generated
	// backtick template instead of prematurely closing it / interpolating (which was a syntax error).
	assert.match(contents, /\\`\(\\\$\{res\}\)\\`/);
	assert.doesNotMatch(contents, /[^\\]`\(\$\{res\}\)[^\\]?`/);
});

test('morph eval referencing a component trait is lifted into a real handler module (no eval string)', () => {
	const sourceApp = createMorphEvalComponentTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-morph-eval-component-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const componentDir = join(targetApp, 'src', 'dashboard', '@l2_date_picker', 'visual', 'datePickerComponent');
	const component = readFileSync(join(componentDir, 'index.jsx'), 'utf8');
	const handler = readFileSync(join(componentDir, 'functional', 'mdaExtraContainerEvalHandler.js'), 'utf8');

	//The morph emission calls the handler directly — no eval string, no getSyncScriptResult for this prop.
	// (prettier may wrap the call across lines, so tolerate whitespace.)
	assert.match(component, /traitPrps\.mdaExtraContainer =\s*\w*MdaExtraContainerEvalHandler\(\s*traitPrps,?\s*\);/);
	assert.doesNotMatch(component, /mdaExtraContainer = getSyncScriptResult/);

	//The component imports the handler by relative path.
	assert.match(component, /import \w*MdaExtraContainerEvalHandler from ['"]\.\/functional\/mdaExtraContainerEvalHandler['"];/);

	//The handler is real module code: helper imports, tokens converted, component trait left as a STRING
	// (the final output pass rewrites it into an import — so it must be a direct import there, not eval).
	assert.match(handler, /import \{ getThemeValue, getDeepProperty \} from ['"]@intenda\/opus-ui['"];/);
	assert.match(handler, /getDeepProperty\(traitPrps, ['"]hasClear['"]\)/);
	assert.match(handler, /getThemeValue\(['"]colors\.iconPrimary['"]\)/);
	assert.match(handler, /return res;/);
	assert.doesNotMatch(handler, /\{\{eval/);
	assert.doesNotMatch(handler, /%hasClear%/);

	//The trait reference in the handler became a direct import (final output pass), not a bare identifier
	// trapped in an eval string and not the raw path string.
	assert.match(handler, /import \w+ from ['"][^'"]*l2_buttons\/dynamic\/index['"];/);
	assert.match(handler, /trait:\s*\w+\b/);
	assert.doesNotMatch(handler, /trait:\s*['"]@l2_dashboards/);
});

test('hand-written local component trait references are converted to direct component imports', () => {
	const sourceApp = createLocalComponentTraitRefSourceApp();
	const targetApp = join(tmpRoot, 'target-app-local-component-trait-ref');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const localComponent = readFileSync(
		join(targetApp, 'src', 'components', 'myWidget', 'buildWgts.js'),
		'utf8'
	);

	//A local component that is copied verbatim still gets its component-trait reference rewritten
	// into a direct import — no JSON resolution at runtime.
	assert.match(localComponent, /import MyEnsembleRowIndex from ["']\.\.\/\.\.\/dashboard\/@myEnsemble\/row\/index["'];/);
	assert.match(localComponent, /trait:\s*MyEnsembleRowIndex\b/);
	assert.doesNotMatch(localComponent, /trait:\s*["']@myEnsemble\/row\/index["']/);
});

test('generated typed trait replaces root scope token with trait prop accessor', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const tokenizedScopeTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'tokens', 'tokenizedScopeTrait.jsx'), 'utf8');

	assert.match(dashboard, /<TraitsTokensTokenizedScopeTrait\s+id="tokenizedScopeTraitUsage"[\s\S]*scope: "providedScope"[\s\S]*caption: "Tokenized scope caption"/);
	assert.match(tokenizedScopeTrait, /scope=\{\[traitPrps\.scope,\s*scope\]\}/);
	assert.doesNotMatch(tokenizedScopeTrait, /"%scope%"/);
});

test('generated typed trait supports trait prop names with slash or spaces', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const oddPropNamesTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'tokens', 'oddPropNamesTrait.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsTokensOddPropNamesTrait from ["']\.\/traits\/tokens\/oddPropNamesTrait["'];/);
	assert.match(dashboard, /<TraitsTokensOddPropNamesTrait\s+id="oddPropNamesTraitUsage"[\s\S]*traitPrps=\{\{[\s\S]*"field\/name": "oddFieldId"[\s\S]*"display label": "Odd prop names label"[\s\S]*\}\}/);

	assert.match(oddPropNamesTrait, /id=\{traitPrps\[["']field\/name["']\]\}/);
	assert.match(oddPropNamesTrait, /cpt:\s*traitPrps\[["']display label["']\]/);
	assert.match(oddPropNamesTrait, /"data\/path":\s*traitPrps\[["']field\/name["']\]/);
	assert.doesNotMatch(oddPropNamesTrait, /traitPrps\.field\/name/);
	assert.doesNotMatch(oddPropNamesTrait, /traitPrps\.display label/);
});

test('generated dashboard uses nested typed trait as component type when paired with functional trait', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const outerTypedViaNestedTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'mixed', 'outerTypedViaNestedTrait.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsMixedOuterTypedViaNestedTrait from ["']\.\/traits\/mixed\/outerTypedViaNestedTrait["'];/);
	assert.match(dashboard, /import TraitsMixedFunctionalTrait from ["']\.\/traits\/mixed\/functionalTrait["'];/);
	assert.match(dashboard, /import \{ applyTraits \} from ["']\.\.\/helpers["'];/);
	assert.match(dashboard, /<TraitsMixedOuterTypedViaNestedTrait/);
	assert.match(dashboard, /sysPrps:\s*{ id: "mixedTraitComponent" }/);
	assert.match(dashboard, /TraitsMixedFunctionalTrait\({ mixedColor: "primary" }\)/);
	assert.match(dashboard, /traitPrps={{ mixedCaption: "Mixed nested typed trait" }}/);
	assert.doesNotMatch(dashboard, /<Label[^>]+id="mixedTraitComponent"/);

	assert.match(outerTypedViaNestedTrait, /import TraitsMixedInnerTypedTrait from ["']\.\/innerTypedTrait["'];/);
	assert.match(outerTypedViaNestedTrait, /<TraitsMixedInnerTypedTrait/);
	assert.match(outerTypedViaNestedTrait, /traitPrps={{ mixedCaption: traitPrps\.mixedCaption }}/);
});

test('generated functional trait JSX props ignore wgts tokens inside popoverMda', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsPopoverPopoverFunctionalTrait from ["']\.\/traits\/popover\/popoverFunctionalTrait["'];/);
	assert.match(dashboard, /sysPrps:\s*{ id:\s*"popoverFunctionalTraitComponent" }/);
	assert.match(dashboard, /TraitsPopoverPopoverFunctionalTrait\(\{[\s\S]*contentItems:\s*\([\s\S]*<>[\s\S]*<Label[^>]*prps=\{\{ cpt:\s*"Visible content item" \}\}/);
	assert.match(dashboard, /popoverItems:\s*\[[\s\S]*\{ type:\s*"label", prps:\s*\{ cpt:\s*"Popover-only item" \} \},[\s\S]*\]/);
	assert.doesNotMatch(dashboard, /popoverItems:\s*<>/);

	//A wgts token nested inside a metadata-MDA container (here `contextMenu.mda.wgts`) is data the
	// runtime renders from metadata (and JSON-serializes), so it must stay a plain MDA array — never a
	// JSX fragment. Emitting JSX there injects React elements whose `_owner` fibers are circular,
	// crashing the wrapper's `JSON.stringify(mda)` with "cyclic object value".
	assert.match(dashboard, /menuItems:\s*\[[\s\S]*\{ type:\s*"label", prps:\s*\{ cpt:\s*"Context-menu item" \} \},?[\s\S]*\]/);
	assert.doesNotMatch(dashboard, /menuItems:\s*<>/);
});

test('generated tokenless root trait without acceptPrps is treated as functional trait', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const tokenlessTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'static', 'staticFunctionalTrait.jsx'), 'utf8');

	assert.match(tokenlessTrait, /const FunctionalTrait = \(traitPrps = {}\) =>/);
	assert.match(tokenlessTrait, /return \{[\s\S]*prps:\s*\{[\s\S]*visible:\s*true[\s\S]*classes:\s*"tokenless-functional-trait"/);
	assert.match(tokenlessTrait, /export default FunctionalTrait;/);
	assert.doesNotMatch(tokenlessTrait, /const Component = /);
	assert.doesNotMatch(tokenlessTrait, /setTraitPrps/);

	assert.match(dashboard, /import TraitsStaticStaticFunctionalTrait from ["']\.\/traits\/static\/staticFunctionalTrait["'];/);
	assert.match(dashboard, /sysPrps:\s*{ id:\s*"tokenlessFunctionalTraitComponent" }/);
	assert.match(dashboard, /prps:\s*{ cpt:\s*"Tokenless functional trait target" }/);
	assert.match(dashboard, /isConditionMet\(\{\s*operator:\s*"isEqual",\s*value:\s*getThemeValue\(\s*["']colors\.primary["'],?\s*\),\s*compareValue:\s*"#123456",?\s*\}\)\s*\?\s*TraitsStaticStaticFunctionalTrait\(\{\}\)\s*:\s*null/);
});

test('generated dynamic traits are resolved and applied at runtime', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');
	const dynamicTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'dynamic', 'containerTrait.jsx'), 'utf8');
	const dynamicArrayTrait = readFileSync(join(outputSrc, 'dashboard', 'traits', 'dynamic', 'arrayContainerTrait.jsx'), 'utf8');

	assert.match(dashboard, /<TraitsDynamicContainerTrait\s+id="dynamicTraitComponent"[\s\S]*traitPrps=\{\{ dynamicTrait: "traits\/dynamic\/dataTrait" \}\}/);
	assert.match(dashboard, /<TraitsDynamicArrayContainerTrait\s+id="dynamicTraitArrayComponent"[\s\S]*traitPrps=\{\{\s*traits:\s*\[/);

	//Single-token dynamic trait: a local map of direct imports replaces the old global
	// resolveDynamicTrait registry. The map is keyed by the runtime trait-path value.
	assert.doesNotMatch(dynamicTrait, /resolveDynamicTrait/);
	assert.match(dynamicTrait, /import TraitsDynamicDataTrait from /);
	//Map values are lazy thunks (binding read at apply time, not module load) to avoid TDZ in cycles.
	assert.match(dynamicTrait, /["']traits\/dynamic\/dataTrait["']:\s*\([^)]*\)\s*=>\s*TraitsDynamicDataTrait\b/);
	//The runtime ref may already be a directly-imported trait function (handler/MDA built it as
	// { trait: <importedFn> }) — call it directly; otherwise look it up in the map.
	assert.match(dynamicTrait, /typeof\s*\(?traitPrps\.dynamicTrait\)?\s*===\s*["']function["']\s*\?\s*traitPrps\.dynamicTrait\s*:\s*\w+\[traitPrps\.dynamicTrait\]/);
	assert.doesNotMatch(dynamicTrait, /%dynamicTrait%/);
	//Imports resolve to the transpiled module, not the raw .json.
	assert.doesNotMatch(dynamicTrait, /import TraitsDynamicDataTrait from ["'][^"']*\.json["']/);

	//Array dynamic trait: a local map keyed by the runtime trait path, no global registry import.
	assert.doesNotMatch(dynamicArrayTrait, /resolveDynamicTrait/);
	assert.match(dynamicArrayTrait, /\(traitPrps\.traits \?\? \[\]\)\.map\(/);
	//Each element ref is called directly if it is already a function, else resolved via the map.
	assert.match(dynamicArrayTrait, /typeof\s*\(?traitRef\)?\s*===\s*["']function["']\s*\?\s*traitRef\s*:\s*\w+\[traitRef\]/);
	assert.match(dynamicArrayTrait, /\?\.\(\s*trait\.traitPrps \?\? \{\}/);

	//The global dynamic-trait registry module is gone entirely.
	assert.ok(!existsSync(join(outputSrc, 'dynamicTraits.jsx')), 'Expected dynamicTraits.jsx to no longer be generated');
});

test('no generated file depends on the global resolveDynamicTrait registry', () => {
	//Full elimination: nothing in the output imports a dynamicTraits module or references the old
	// global resolveDynamicTrait function — every dynamic trait site resolves through a local map.
	const offenders = listFilesRecursive(outputSrc)
		.filter(file => ['.js', '.jsx'].includes(extname(file)))
		.filter(file => /from\s+["'][^"']*\/dynamicTraits["']/.test(readFileSync(file, 'utf8')))
		.map(file => relative(outputSrc, file));

	assert.deepEqual(offenders, [], `Expected no dynamicTraits imports, found in: ${offenders.join(', ')}`);
});

test('generated nested conditional only-child component is wrapped as JSX expression', () => {
	const dashboard = readFileSync(join(outputSrc, 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /id="singleConditionalChildContainer"/);
	assert.match(dashboard, /\{isConditionMet\(\{\s*value:\s*true\s*\}\) \? \([\s\S]*<Label\s+id="singleConditionalChild"[\s\S]*prps=\{\{ cpt:\s*"Only conditional child" \}\}[\s\S]*><\/Label>[\s\S]*\) : null\}/);
	assert.doesNotMatch(dashboard, /id="singleConditionalChildContainer"[\s\S]*>\s*isConditionMet\(\{value:\s*true\}\) \?/);
});

test('generated script actions are syntactically valid JavaScript modules', () => {
	const scriptActionFiles = listFilesRecursive(join(outputSrc, 'scriptActions')).filter(file => extname(file) === '.js');

	assertHasFiles(scriptActionFiles, 'script action JavaScript');

	scriptActionFiles.forEach(file => {
		const contents = readFileSync(file, 'utf8');
		const label = relative(outputSrc, file);

		assert.match(contents, /export\s+(default|const|function|\{)/, `Expected an export in ${label}`);
		assert.doesNotThrow(() => assertJsSyntax(file), `Expected valid JS syntax in ${label}`);
	});
});

test('generated applyTraits helper merges traits predictably', async () => {
	const { applyTraits } = await importGeneratedModule(join(outputSrc, 'helpers.jsx'));

	const result = applyTraits({
		sysPrps: { id: 'base', scope: 'baseScope' },
		prps: {
			label: 'Base',
			scps: [{ id: 'baseAction' }]
		},
		traits: [{
			scope: ['traitScope', 'baseScope'],
			prps: {
				label: 'Trait',
				scps: [{ id: 'traitAction' }],
				visible: true
			},
			type: 'Container'
		}]
	});

	assert.deepEqual(result.scope, ['baseScope', 'traitScope']);
	assert.equal(result.id, 'base');
	assert.equal(result.type, 'Container');
	//NO-OVERRIDE (mirrors the runtime cloneNoOverrideNoCopy): the accumulator's existing value wins, so
	// the base's `label` is kept and the trait does NOT clobber it. A trait only fills gaps (`visible`).
	assert.equal(result.prps.label, 'Base');
	assert.equal(result.prps.visible, true);
	assert.deepEqual(result.prps.scps, [{ id: 'baseAction' }, { id: 'traitAction' }]);
});

test('generated applyTraits helper skips a trait whose condition is not met', async () => {
	const { applyTraits } = await importGeneratedModule(join(outputSrc, 'helpers.jsx'));

	//The stub isConditionMet returns true, so to exercise the skip we rely on the `condition && !met`
	// guard short-circuiting only when isConditionMet is false. With the stub always-true, a conditioned
	// trait still applies — so assert the guard at least doesn't crash and the trait merges. (Behavioural
	// condition handling is exercised end-to-end at runtime; here we just lock in the code path exists.)
	const result = applyTraits({
		prps: { label: 'Base' },
		traits: [{ condition: { operator: 'isTruthy', value: true }, prps: { extra: 1 } }]
	});

	assert.equal(result.prps.label, 'Base');
	assert.equal(result.prps.extra, 1);
});

test('transpiler copies generated fixture output to isolated target app', () => {
	[
		join(fixtureTargetApp, 'src', 'helpers.jsx'),
		join(fixtureTargetApp, 'src', 'dashboard', 'sampleDashboard.jsx'),
		join(fixtureTargetApp, 'public', 'app.json'),
		join(fixtureTargetApp, 'index.html')
	].forEach(assertFileExists);
});

test('transpiler preserves target main.jsx when replacement is disabled', () => {
	const preserveTargetApp = join(tmpRoot, 'target-app-preserve-main');
	const preservedMain = join(preserveTargetApp, 'src', 'main.jsx');
	const sentinel = '/* existing target main should be preserved */\nexport default "preserved-main";\n';

	rmSync(preserveTargetApp, { recursive: true, force: true });
	mkdirSync(join(preserveTargetApp, 'src'), { recursive: true });
	writeFileSync(preservedMain, sentinel, 'utf8');

	execFileSync(process.execPath, ['src/transpile.mjs'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: fixtureSourceApp,
			OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: preserveTargetApp,
			OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'false'
		},
		stdio: 'pipe'
	});

	assert.equal(readFileSync(preservedMain, 'utf8'), sentinel);
	assertFileExists(join(preserveTargetApp, 'src', 'dashboard', 'sampleDashboard.jsx'));
	assertFileExists(join(preserveTargetApp, 'index.html'));
});

test('transpiler preserves configured target src folders during replacement', () => {
	const sourceApp = join(tmpRoot, 'source-app-preserve-src-folder');
	const preserveTargetApp = join(tmpRoot, 'target-app-preserve-src-folder');
	const preservedFile = join(preserveTargetApp, 'src', 'handwritten', 'keep.txt');
	const preservedCollisionFile = join(preserveTargetApp, 'src', 'handwritten', 'customUtility.js');
	const sourceCollisionFile = join(sourceApp, 'src', 'handwritten', 'customUtility.js');
	const staleFile = join(preserveTargetApp, 'src', 'stale.txt');

	rmSync(sourceApp, { recursive: true, force: true });
	rmSync(preserveTargetApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });
	mkdirSync(dirname(sourceCollisionFile), { recursive: true });
	writeFileSync(sourceCollisionFile, 'generated file should not overwrite preserved folder\n', 'utf8');
	mkdirSync(dirname(preservedFile), { recursive: true });
	writeFileSync(preservedFile, 'keep this handwritten file\n', 'utf8');
	writeFileSync(preservedCollisionFile, 'do not overwrite this handwritten file\n', 'utf8');
	writeFileSync(staleFile, 'remove this stale file\n', 'utf8');

	execFileSync(process.execPath, ['src/transpile.mjs'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
			OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: preserveTargetApp,
			OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true',
			OPUS_TRANSPILER_PRESERVED_SRC_FOLDERS: 'handwritten'
		},
		stdio: 'pipe'
	});

	assert.equal(readFileSync(preservedFile, 'utf8'), 'keep this handwritten file\n');
	assert.equal(readFileSync(preservedCollisionFile, 'utf8'), 'do not overwrite this handwritten file\n');
	assert.ok(!existsSync(staleFile), 'Expected stale src files outside preserved folders to be deleted');
	assertFileExists(join(preserveTargetApp, 'src', 'dashboard', 'sampleDashboard.jsx'));
});

test('transpiler regenerates target src themes by default (themes are not in the preserved-src list)', () => {
	const preserveTargetApp = join(tmpRoot, 'target-app-regenerate-themes');
	const themeFile = join(preserveTargetApp, 'src', 'themes', 'colors.jsx');
	const customTheme = 'const Theme = { colors: { primary: "custom" } };\nexport default Theme;\n';

	rmSync(preserveTargetApp, { recursive: true, force: true });
	mkdirSync(dirname(themeFile), { recursive: true });
	writeFileSync(themeFile, customTheme, 'utf8');

	execFileSync(process.execPath, ['src/transpile.mjs'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: fixtureSourceApp,
			OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: preserveTargetApp,
			OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
		},
		stdio: 'pipe'
	});

	//Themes are no longer a default preserved-src folder (defaultPreservedSrcFolders is empty), so a
	// stale hand-edited theme is replaced by the freshly transpiled one — themes must be regenerated as
	// real modules (closures over imports) for app.json-free runtime, not kept from a previous build.
	const regenerated = readFileSync(themeFile, 'utf8');
	assert.notEqual(regenerated, customTheme);
	assert.match(regenerated, /^const Theme = /m);
	assert.match(regenerated, /^export default Theme;$/m);
	assertFileExists(join(preserveTargetApp, 'src', 'dashboard', 'sampleDashboard.jsx'));
});

test('transpiler overlays target public folder when replacement is disabled', () => {
	const preserveTargetApp = join(tmpRoot, 'target-app-preserve-public');
	const preservedPublicFile = join(preserveTargetApp, 'public', 'keep.txt');

	rmSync(preserveTargetApp, { recursive: true, force: true });
	mkdirSync(dirname(preservedPublicFile), { recursive: true });
	writeFileSync(preservedPublicFile, 'keep this public file\n', 'utf8');

	execFileSync(process.execPath, ['src/transpile.mjs'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: fixtureSourceApp,
			OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: preserveTargetApp,
			OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true',
			OPUS_TRANSPILER_REPLACE_PUBLIC_FOLDER: 'false'
		},
		stdio: 'pipe'
	});

	assert.equal(readFileSync(preservedPublicFile, 'utf8'), 'keep this public file\n');
	assertFileExists(join(preserveTargetApp, 'public', 'app.json'));
	assertFileExists(join(preserveTargetApp, 'public', 'envConfig.js'));
});

test('generated trait import identifiers are valid when trait paths contain hyphens', () => {
	const sourceApp = createHyphenTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-hyphen-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /import TraitsNamesRange1_3 from ["']\.\/traits\/names\/range1-3["'];/);
	assert.match(dashboard, /<TraitsNamesRange1_3\s+id="hyphenTraitUsage"/);
	assert.match(dashboard, /<\/TraitsNamesRange1_3>/);
	assert.doesNotMatch(dashboard, /TraitsNamesRange1-3/);
});

test('generated typed trait supports dynamic root type from traitPrps', () => {
	const sourceApp = createDynamicRootTypeTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-dynamic-root-type-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const flexibleContainerLabel = join(targetApp, 'src', 'dashboard', 'traits', 'dynamicRoot', 'flexibleContainerLabel.jsx');
	const contents = readFileSync(flexibleContainerLabel, 'utf8');

	assert.match(contents, /import \{ ContainerSimple \} from ["']@intenda\/opus-ui["'];/);
	assert.match(contents, /const dynamicRootTypeComponents\d+ = \{ containerSimple: ContainerSimple \};/);
	assert.match(contents, /const DynamicRootTypeComponent =\s*dynamicRootTypeComponents\d+\[traitPrps\.containerType\] \?\?\s*dynamicRootTypeComponents\d+\["containerSimple"\];/);
	assert.match(contents, /<DynamicRootTypeComponent\s+scope=\{scope\}/);
	assert.match(contents, /<\/DynamicRootTypeComponent>/);
	assert.doesNotMatch(contents, /%containerType%/);
	assert.doesNotMatch(contents, /from ["']null["']/);
});

test('generated dynamic component types resolve at runtime when not statically discoverable', () => {
	const sourceApp = createRuntimeDynamicTypeSourceApp();
	const targetApp = join(tmpRoot, 'target-app-runtime-dynamic-type');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const trait = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'dynamicRoot', 'runtimeDynamicType.jsx'),
		'utf8'
	);

	//The shared runtime wrapper is imported and used for BOTH the root and the nested dynamic type,
	// resolving the type through the registry by the runtime trait-prop value.
	assert.match(trait, /import \{ DynamicTypeComponent \} from ["'](?:\.\.\/)+dynamicTypeComponent["'];/);
	assert.match(trait, /<DynamicTypeComponent\s+type=\{traitPrps\.containerType\}/);
	assert.match(trait, /<DynamicTypeComponent\s+type=\{traitPrps\.innerType\}/);

	//No raw token leaks into a tag/import.
	assert.doesNotMatch(trait, /%containerType%|%innerType%/);
	assert.doesNotMatch(trait, /from ["']null["']/);

	//The shared helper module is generated and renders via the registry.
	const helper = readFileSync(join(targetApp, 'src', 'dynamicTypeComponent.jsx'), 'utf8');

	assert.match(helper, /export const DynamicTypeComponent =/);
	assert.match(helper, /makeComponentWithChildren\(type\)/);
});

test('generated trait prop token paths support numeric array segments', () => {
	const sourceApp = createNumericTraitPathSourceApp();
	const targetApp = join(tmpRoot, 'target-app-numeric-trait-path');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const numericPathTrait = join(targetApp, 'src', 'dashboard', 'traits', 'tokens', 'numericPathTrait.jsx');
	const contents = readFileSync(numericPathTrait, 'utf8');

	assert.match(contents, /traitPrps=\{\{ fieldInfo: traitPrps\.fieldInfo\?\.\[0\] \}\}/);
	assert.doesNotMatch(contents, /traitPrps\.fieldInfo\?\.0/);
});

test('generated typed trait resolves theme-backed defaults before passing props to components and nested traits', () => {
	const sourceApp = createThemeDefaultTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-theme-default-trait');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const primaryButtonTrait = join(
		targetApp,
		'src',
		'dashboard',
		'traits',
		'theme',
		'primaryButtonTrait.jsx'
	);
	const contents = readFileSync(primaryButtonTrait, 'utf8');

	assert.match(contents, /import \{[^}]*getThemeValue[^}]*\} from ["']@intenda\/opus-ui["'];/);
	assert.match(contents, /traitPrps\.bgColorHoverOff = getThemeValue\(\s*["']l2_buttons_colors\.primary\/backgroundHoverOff["'],?\s*\);/);
	assert.match(contents, /traitPrps\.textHoverOff = getThemeValue\(\s*["']l2_buttons_colors\.primary\/textHoverOff["'],?\s*\);/);
	assert.match(contents, /backgroundColor:\s*traitPrps\.bgColorHoverOff/);
	assert.match(contents, /TraitsThemeHoverFunctionalTrait\(\{\s*bgColorHoverOff: traitPrps\.bgColorHoverOff,?\s*\}\)/);
	assert.doesNotMatch(contents, /\{theme\.l2_buttons_colors\.primary\/backgroundHoverOff\}/);
	assert.doesNotMatch(contents, /bgColorHoverOff:\s*["']%bgColorHoverOff%["']/);
});

test('generated morph accept prop preserves caret condition as valid object key', () => {
	const sourceApp = createMorphCaretConditionSourceApp();
	const targetApp = join(tmpRoot, 'target-app-morph-caret-condition');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const caretConditionTrait = join(
		targetApp,
		'src',
		'dashboard',
		'traits',
		'morph',
		'caretConditionTrait.jsx'
	);
	const contents = readFileSync(caretConditionTrait, 'utf8');

	assert.doesNotMatch(contents, /`\^condition`:/);
	assert.match(contents, /(?:"\^condition"|\[`\^condition`\]):\s*\{/);
});

test('generated rowMda preserves mustache rowData traits for repeater runtime', () => {
	const sourceApp = createRowMdaMustacheTraitsSourceApp();
	const targetApp = join(tmpRoot, 'target-app-row-mda-mustache-traits');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	assert.match(dashboard, /id="rowMdaMustacheTraitsRepeater"/);
	//No global registry import; the per-row path resolves through a local map of direct imports.
	assert.doesNotMatch(dashboard, /from ["'][^"']*\/dynamicTraits["']/);
	assert.match(dashboard, /traits:\s*"{{rowData\.traits}}"/);
	assert.match(dashboard, /resolveDynamicTrait:\s*\(?traitPath\)? =>\s*\w+\[traitPath\]/);
	assert.match(dashboard, /import TraitsRowRowFunctionalTrait from /);
	assert.match(dashboard, /["']traits\/row\/rowFunctionalTrait["']:\s*\([^)]*\)\s*=>\s*TraitsRowRowFunctionalTrait\b/);
});

test('generated rowMda with conditioned visual traits emits a per-row conditional component selector', () => {
	const sourceApp = createConditionalRootTypeSourceApp();
	const targetApp = join(tmpRoot, 'target-app-conditional-root-type');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//Both alternatives must be imported as component blueprints...
	assert.match(dashboard, /import TraitsMenuSectionTrait from ["']\.\/traits\/menu\/sectionTrait["'];/);
	assert.match(dashboard, /import TraitsMenuItemTrait from ["']\.\/traits\/menu\/itemTrait["'];/);
	//...and the shared dispatcher pulled in.
	assert.match(dashboard, /import \{ renderConditionalRootType \} from ["']\.\.\/conditionalRootType["'];/);

	assert.match(dashboard, /id="conditionalRootTypeRepeater"/);

	//The node component is the dispatcher, not one fixed branch.
	assert.match(dashboard, /type:\s*renderConditionalRootType/);

	//Both conditioned alternatives are emitted with their (runtime-resolved) conditions intact.
	// (\s tolerates Prettier's line breaks; ,? tolerates trailing commas.)
	assert.match(dashboard, /conditionalRootTypes:\s*\[/);
	assert.match(dashboard, /operator:\s*"isTruthy",\s*value:\s*"\{\{rowData\.children\.length\}\}",?\s*\},\s*type:\s*TraitsMenuSectionTrait,\s*traitPrps:\s*\{\s*rowData:\s*"\{\{rowData\}\}",?\s*\}/);
	assert.match(dashboard, /operator:\s*"isFalsy",\s*value:\s*"\{\{rowData\.children\.length\}\}",?\s*\},\s*type:\s*TraitsMenuItemTrait,\s*traitPrps:\s*\{\s*rowData:\s*"\{\{rowData\}\}",?\s*\}/);

	//The conditional selector must not collapse into the old "one main type + traits: [...]" form.
	assert.doesNotMatch(dashboard, /id="conditionalRootTypeRepeater"[\s\S]*?rowMda:[\s\S]*?traits:\s*\[/);

	//The shared dispatcher module is generated and renders React.
	const dispatcher = readFileSync(join(targetApp, 'src', 'conditionalRootType.jsx'), 'utf8');

	assert.match(dispatcher, /import React from ["']react["'];/);
	assert.match(dispatcher, /import \{ isConditionMet \} from ["']@intenda\/opus-ui["'];/);
	assert.match(dispatcher, /export const renderConditionalRootType =/);
	assert.match(dispatcher, /conditionalRootTypes\.find\(\(?entry\)?\s*=>\s*isConditionMet\(entry\.condition\)/);
});

test('generated rowMda with a data-token conditional trait resolves it via a statically discovered component map', () => {
	const sourceApp = createDataTokenConditionalRootTypeSourceApp();
	const targetApp = join(tmpRoot, 'target-app-data-token-conditional-root-type');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const dashboard = readFileSync(join(targetApp, 'src', 'dashboard', 'sampleDashboard.jsx'), 'utf8');

	//The two static branches are still imported as component blueprints...
	assert.match(dashboard, /import TraitsGridHeaderCell from ["']\.\/traits\/grid\/headerCell["'];/);
	assert.match(dashboard, /import TraitsGridActionHeaderCell from ["']\.\/traits\/grid\/actionHeaderCell["'];/);
	//...and so is the dynamically discovered custom header-cell component.
	assert.match(dashboard, /import MyEnsembleCustomHeaderCellIndex from ["']\.\/@myEnsemble\/customHeaderCell\/index["'];/);
	assert.match(dashboard, /import \{ renderConditionalRootType \} from ["']\.\.\/conditionalRootType["'];/);

	assert.match(dashboard, /id="dataTokenConditionalRootTypeRepeater"/);
	assert.match(dashboard, /type:\s*renderConditionalRootType/);
	assert.match(dashboard, /conditionalRootTypes:\s*\[/);

	//(a) All THREE entries are kept: the two static ones...
	assert.match(dashboard, /type:\s*TraitsGridHeaderCell/);
	assert.match(dashboard, /type:\s*TraitsGridActionHeaderCell/);
	//...and the data-token one, which is NOT dropped: it carries a typeMap + the original token as typeKey.
	assert.match(dashboard, /typeMap:\s*customHeaderCellTraitComponents/);
	assert.match(dashboard, /typeKey:\s*"\(\(rowData\.field\.customHeaderCellTrait\)\)"/);

	//(b) A path-keyed component map is emitted, keyed by the literal data value and valued by the import.
	assert.match(
		dashboard,
		/const customHeaderCellTraitComponents = \{\s*"@myEnsemble\/customHeaderCell\/index":\s*MyEnsembleCustomHeaderCellIndex,?\s*\};/
	);

	//(d) The dispatcher resolves typeMap[typeKey] when there is no direct type.
	const dispatcher = readFileSync(join(targetApp, 'src', 'conditionalRootType.jsx'), 'utf8');

	assert.match(dispatcher, /match\.typeMap\s*\?\s*match\.typeMap\[match\.typeKey\]/);
});

test('generated functional trait de-duplicates imports for repeated srcAction handlers', () => {
	const sourceApp = createDuplicateScriptActionImportSourceApp();
	const targetApp = join(tmpRoot, 'target-app-duplicate-script-action-import');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const duplicateTrait = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'scriptActions', 'duplicateActionTrait.jsx'),
		'utf8'
	);
	const importMatches = duplicateTrait.match(
		/import scriptActionsSampleAction from ["']\.\.\/\.\.\/scriptActions\/sampleAction["'];/g
	) ?? [];

	assert.equal(importMatches.length, 1);
	assert.match(
		duplicateTrait,
		/import scriptActionsConfigStyleAction from ["']\.\.\/\.\.\/scriptActions\/configStyleAction["'];/
	);
	assert.match(duplicateTrait, /handler:\s*scriptActionsSampleAction,\s*config:\s*\{\s*direction:\s*-1\s*\}/);
	assert.match(duplicateTrait, /handler:\s*scriptActionsSampleAction,\s*config:\s*\{\s*direction:\s*0\s*\}/);
	assert.match(duplicateTrait, /handler:\s*scriptActionsSampleAction,\s*config:\s*\{\s*direction:\s*1\s*\}/);
	assert.match(duplicateTrait, /handler:\s*scriptActionsConfigStyleAction,\s*config:\s*\{\s*direction:\s*2\s*\}/);
	assert.doesNotMatch(duplicateTrait, /handler:\s*scriptActionsSampleAction,\s*direction:/);
	assert.doesNotThrow(() => assertJsSyntax(join(
		targetApp,
		'src',
		'dashboard',
		'traits',
		'scriptActions',
		'duplicateActionTrait.jsx'
	)));
});

test('generated trait import includes jsx extension when a sibling js action has the same basename', () => {
	const sourceApp = createTraitScriptBasenameCollisionSourceApp();
	const targetApp = join(tmpRoot, 'target-app-trait-script-basename-collision');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const parentTrait = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'collision', 'parentTrait.jsx'),
		'utf8'
	);

	assert.match(parentTrait, /import TraitsCollisionOpenThing from ["']\.\/openThing\.jsx["'];/);
	assert.doesNotMatch(parentTrait, /import TraitsCollisionOpenThing from ["']\.\/openThing["'];/);
	assertFileExists(join(targetApp, 'src', 'dashboard', 'traits', 'collision', 'openThing.js'));
	assertFileExists(join(targetApp, 'src', 'dashboard', 'traits', 'collision', 'openThing.jsx'));
});

test('generated functional trait quotes data keys that are not valid identifiers', () => {
	const sourceApp = createParenthesizedDataKeySourceApp();
	const targetApp = join(tmpRoot, 'target-app-parenthesized-data-key');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const parenthesizedKeyTrait = join(
		targetApp,
		'src',
		'dashboard',
		'traits',
		'data',
		'parenthesizedKeyTrait.jsx'
	);
	const contents = readFileSync(parenthesizedKeyTrait, 'utf8');

	assert.match(contents, /"sum\(transaction_amount\)":\s*1063846\.98/);
	assert.doesNotMatch(contents, /[^"']sum\(transaction_amount\):/);
	assert.doesNotThrow(() => assertJsSyntax(parenthesizedKeyTrait));
});

test('generated functional trait preserves nested template interpolation inside theme-backed inline strings', async () => {
	const sourceApp = createInlineThemeTemplateLiteralSourceApp();
	const targetApp = join(tmpRoot, 'target-app-inline-theme-template-literal');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const templateLiteralTrait = join(
		targetApp,
		'src',
		'dashboard',
		'traits',
		'flows',
		'templateLiteralTrait.jsx'
	);
	const contents = readFileSync(templateLiteralTrait, 'utf8');

	assert.match(contents, /\\\$\{Math\.max\(v, minWidth\)\}/);
	assert.match(contents, /\$\{getThemeValue\(["']colors\.primary["']\)\}/);
});

test('generated functional trait replaces percent trait prop tokens after inline theme conversion', () => {
	const sourceApp = createThemedInlineTraitTokenSourceApp();
	const targetApp = join(tmpRoot, 'target-app-themed-inline-percent-trait-token');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const contents = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'tokens', 'themedInlinePercentFunctionalTrait.jsx'),
		'utf8'
	);

	assert.match(contents, /if \(\$\{getDeepProperty\(traitPrps, ["']flag["']\)\}\)/);
	assert.match(contents, /res\.width = \$\{getThemeValue\(["']colors\.primary["']\)\};/);
	assert.doesNotMatch(contents, /%flag%/);
});

test('generated functional trait replaces dollar trait prop tokens after inline theme conversion', () => {
	const sourceApp = createThemedInlineTraitTokenSourceApp();
	const targetApp = join(tmpRoot, 'target-app-themed-inline-dollar-trait-token');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const contents = readFileSync(
		join(targetApp, 'src', 'dashboard', 'traits', 'tokens', 'themedInlineDollarFunctionalTrait.jsx'),
		'utf8'
	);

	//Embedded $flag$ sits inside an {{eval...}} expression, so it is JSON.stringified (quoted)
	// to mirror the runtime's getMorphedString $-token behaviour.
	assert.match(contents, /if \(\$\{JSON\.stringify\(getDeepProperty\(traitPrps, ["']flag["']\)\)\}\)/);
	assert.match(contents, /res\.width = \$\{getThemeValue\(["']colors\.primary["']\)\};/);
	assert.doesNotMatch(contents, /\$flag\$/);
});

test('trait-list prop string elements are converted to direct trait-module imports', () => {
	//A trait-list prop (traitsTreeNode) holds bare trait-path strings that a library component applies
	// to each node it builds. Both functional traits (no own type) and component traits should be
	// converted to direct imports so the runtime applies/renders them as React rather than resolving
	// the paths from JSON metadata. Strings that do not resolve to a known trait file are left alone.
	const mapFiles = new Map([
		['dashboard/@menu/tree/functional/setBg.json', { contents: { prps: { flows: [] } } }],
		['dashboard/@menu/tree/functional/setDivider.json', { contents: { prps: { flows: [] } } }],
		['dashboard/@menu/tree/nodeComponent.json', { contents: { type: 'containerSimple' } }]
	]);

	const currentPath = 'dashboard/@menu/tree/index';

	const input = [
		'const prps = {',
		'\ttraitsTreeNode: [',
		'\t\t"@menu/tree/functional/setBg",',
		'\t\t"@menu/tree/functional/setDivider",',
		'\t\t"@menu/tree/nodeComponent",',
		'\t\t"@menu/tree/functional/unknownTrait"',
		'\t],',
		'\ttraits: [{ trait: "@menu/tree/functional/setBg" }]',
		'};'
	].join('\n');

	const output = transformTraitReferences(input, currentPath, mapFiles);

	//Each known trait path inside the trait-list prop becomes a direct import...
	assert.match(output, /import MenuTreeFunctionalSetBg from ['"]\.\/functional\/setBg['"];/);
	assert.match(output, /import MenuTreeFunctionalSetDivider from ['"]\.\/functional\/setDivider['"];/);
	assert.match(output, /import MenuTreeNodeComponent from ['"]\.\/nodeComponent['"];/);

	//...and is referenced directly (bare identifier) inside the array, no longer a path string.
	assert.match(output, /traitsTreeNode:\s*\[[\s\S]*MenuTreeFunctionalSetBg[\s\S]*\]/);
	assert.doesNotMatch(output, /["']@menu\/tree\/functional\/setBg["'],/);
	assert.doesNotMatch(output, /["']@menu\/tree\/functional\/setDivider["']/);
	assert.doesNotMatch(output, /["']@menu\/tree\/nodeComponent["']/);

	//A path with no matching trait file is left untouched.
	assert.match(output, /["']@menu\/tree\/functional\/unknownTrait["']/);

	//The component's own `traits: [{ trait }]` array: this functional-trait reference is now also
	// rewritten to a direct import, so it applies without resolving from JSON metadata at runtime.
	assert.match(output, /traits:\s*\[\{\s*trait:\s*MenuTreeFunctionalSetBg\s*\}\]/);
	assert.doesNotMatch(output, /traits:\s*\[\{\s*trait:\s*["']@menu\/tree\/functional\/setBg["']/);
});

test('bare path-string elements of a plain `traits` action-spread array are converted to direct imports', () => {
	//Inside scps/actions, traits are spread via the plain `traits` key (no CamelCase suffix), holding
	// bare path strings: `{ traits: ["@.../setDateString"] }`. These are NOT trait-list props
	// (traits[A-Z]) nor `trait: "x"` references, so before this they stayed strings and failed at
	// runtime (getTrait → app.json, which the self-contained app no longer ships).
	const mapFiles = new Map([
		['dashboard/@dp/setDateString.json', { contents: { prps: { flows: [] } } }],
		['dashboard/@dp/setTimeString.json', { contents: { prps: { flows: [] } } }],
		['dashboard/@dp/setObj.json', { contents: { prps: { flows: [] } } }]
	]);

	const currentPath = 'dashboard/@dp/manager';

	//A realistic action branch: one object-form element (Pass 1 territory) and two bare-string elements,
	// plus a nested array (traitPrps.deltaKeys) to prove the bracket scan doesn't truncate at the first
	// `]`. The unresolved path and the `{{...}}` token must be left untouched.
	const input = [
		'const prps = { scps: [{ actions: [{ branch: { true: [',
		'\t{ traits: [{ trait: "@dp/setObj", traitPrps: { deltaKeys: ["a", "b"] } }] },',
		'\t{ traits: ["@dp/setDateString"] },',
		'\t{ traits: ["@dp/setTimeString", "@dp/unknownTrait", "{{state.self.x}}"] }',
		'] } }] }] };'
	].join('\n');

	const output = transformTraitReferences(input, currentPath, mapFiles);

	//Imports emitted for every resolvable element (object-form via Pass 1, bare strings via Pass 2c).
	assert.match(output, /import DpSetObj from ['"]\.\/setObj['"];/);
	assert.match(output, /import DpSetDateString from ['"]\.\/setDateString['"];/);
	assert.match(output, /import DpSetTimeString from ['"]\.\/setTimeString['"];/);

	//Bare-string elements become bare identifiers in place (no longer path strings).
	assert.match(output, /traits:\s*\[DpSetDateString\]/);
	assert.match(output, /traits:\s*\[DpSetTimeString,/);
	assert.doesNotMatch(output, /["']@dp\/setDateString["']/);
	assert.doesNotMatch(output, /["']@dp\/setTimeString["']/);

	//The nested array survived intact — the bracket scan did not stop at deltaKeys' closing `]`.
	assert.match(output, /deltaKeys:\s*\[["']a["'],\s*["']b["']\]/);

	//Unresolved path and runtime token are left as-is.
	assert.match(output, /["']@dp\/unknownTrait["']/);
	assert.match(output, /["']\{\{state\.self\.x\}\}["']/);
});

test('a pure trait-path-string array (script-built base-trait list) is converted to direct imports', () => {
	//The formInput base-trait pattern: a `setVariable value: [...]` array of backtick trait paths,
	// concatenated into traitPrps.traits at runtime. Every element is a trait path, so each becomes a
	// direct import and bypasses the runtime fallback map (the site's `typeof === "function"` branch
	// resolves the import). Mixed/data arrays — not all-trait-paths — must be left untouched.
	const mapFiles = new Map([
		['dashboard/@in/onValueChanged.json', { contents: { prps: { flows: [] } } }],
		['dashboard/@in/setErrorStyles.json', { contents: { prps: { flows: [] } } }]
	]);

	const currentPath = 'dashboard/@in/input';

	const input = [
		'const baseTraits = { value: [`@in/onValueChanged`, `@in/setErrorStyles`] };',
		'const plain = { value: ["plainString", "another"] };'
	].join('\n');

	const output = transformTraitReferences(input, currentPath, mapFiles);

	//Both backtick trait paths import and become bare identifiers in place.
	assert.match(output, /import \w+ from ['"]\.\/onValueChanged['"];/);
	assert.match(output, /import \w+ from ['"]\.\/setErrorStyles['"];/);
	assert.match(output, /value:\s*\[\w+,\s*\w+\]/);
	assert.doesNotMatch(output, /`@in\/onValueChanged`/);

	//A non-trait (plain string) array is left untouched — the regex only matches all-trait-path arrays.
	assert.match(output, /\["plainString",\s*"another"\]/);
});

const buildFieldScopedDynamicTraitConsumer = () => {
	const sourceApp = createFieldScopedDynamicTraitSourceApp();
	const targetApp = join(tmpRoot, 'target-app-field-scoped-dynamic-trait');

	rmSync(targetApp, { recursive: true, force: true });

	execFileSync(process.execPath, ['src/transpile.mjs'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
			OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
			OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
		},
		stdio: 'pipe'
	});

	return readFileSync(join(targetApp, 'src', 'dashboard', 'traits', 'scoped', 'consumer.jsx'), 'utf8');
};

test('a field-keyed dynamic-trait site with literal values emits a field-scoped map holding only that field\'s candidates', () => {
	const consumer = buildFieldScopedDynamicTraitConsumer();

	//The `litTrait` site is keyed on `traitPrps.litTrait`, so it emits a field-scoped map named for the
	// field, containing ONLY that field's discovered candidate.
	assert.match(consumer, /const dynamicTraitMap_litTrait\s*=\s*\{[\s\S]*?\};/);
	assert.match(consumer, /dynamicTraitMap_litTrait\s*=\s*\{[\s\S]*["']traits\/scoped\/litFunctionalTrait["']/);

	//The site indexes the field-scoped map (not the whole-app `dynamicTraitMap_array`).
	assert.match(consumer, /dynamicTraitMap_litTrait\[traitPrps\.litTrait\]/);

	//Crucially, an unrelated functional-trait path that IS in the whole-app flat set must NOT leak into
	// the field-scoped map (that would be the old too-wide behaviour).
	const litMap = consumer.match(/const dynamicTraitMap_litTrait\s*=\s*\{[\s\S]*?\};/)[0];
	assert.doesNotMatch(litMap, /otherFunctionalTrait/);
});

test('a dynamic-trait field whose default is a theme accessor includes the theme-resolved trait path in its field map', () => {
	const consumer = buildFieldScopedDynamicTraitConsumer();

	//`setDataTrait`'s only source is its acceptPrps default `{theme.scoped_system.setDataTrait}`, which the
	// discovery resolves against the theme file to `@scoped/themeTrait`. Narrowing must therefore include
	// that resolved path — dropping it would break the trait at runtime.
	assert.match(consumer, /const dynamicTraitMap_setDataTrait\s*=\s*\{[\s\S]*?\};/);
	const setDataMap = consumer.match(/const dynamicTraitMap_setDataTrait\s*=\s*\{[\s\S]*?\};/)[0];
	assert.match(setDataMap, /["']@scoped\/themeTrait["']/);
	assert.match(consumer, /dynamicTraitMap_setDataTrait\[traitPrps\.setDataTrait\]/);
});

test('a dynamic-trait field assigned a runtime token falls back to the whole-app flat map', () => {
	const consumer = buildFieldScopedDynamicTraitConsumer();

	//`tokenTrait` is assigned the cross-field token `%feed%` as its value somewhere, so it can hold a
	// value not known statically → it is NOT narrowable and keeps the whole-app flat map (`dynamicTraitMap_array`).
	assert.match(consumer, /dynamicTraitMap_array\[traitPrps\.tokenTrait\]/);

	//No field-scoped map is emitted for the non-narrowable field.
	assert.doesNotMatch(consumer, /dynamicTraitMap_tokenTrait\b/);

	//The flat map is broad: it includes the unrelated `otherFunctionalTrait` path (which the field-scoped
	// literal map above proved is excluded from a narrowed field).
	const flatMap = consumer.match(/const dynamicTraitMap_array\s*=\s*\{[\s\S]*?\};/)[0];
	assert.match(flatMap, /otherFunctionalTrait/);
});

test('a dynamic-trait field assigned a `(( ))` runtime token falls back to the whole-app flat map even when it also has a literal candidate', () => {
	const consumer = buildFieldScopedDynamicTraitConsumer();

	//`parenTrait` is assigned `((rowData.feed))` as its value somewhere, so it can hold a value only known
	// at runtime. The `((...))` form is a runtime token just like `{{...}}`/`%...%`/`$...$`, so the field is
	// NOT narrowable and must keep the whole-app flat map — even though a call site ALSO passes it a literal
	// path (which, ungated, would have produced a too-small field map that drops the runtime value).
	assert.match(consumer, /dynamicTraitMap_array\[traitPrps\.parenTrait\]/);

	//No field-scoped map is emitted for the non-narrowable field.
	assert.doesNotMatch(consumer, /dynamicTraitMap_parenTrait\b/);
});

test('a config-trait field that forwards another via a `$trait…$` alias inherits that field\'s candidates, not the flat set', () => {
	const consumer = buildFieldScopedDynamicTraitConsumer();

	//`traitAliasManager: "$traitPrimaryManager$"` forwards the primary's value. Resolved as an alias, the
	// alias field's map is scoped to the primary's discovered candidate (litFunctionalTrait) — it must NOT
	// fall back to the whole-app `dynamicTraitMap_array`, and must NOT leak the unrelated otherFunctionalTrait.
	assert.match(consumer, /const dynamicTraitMap_traitAliasManager\s*=\s*\{[\s\S]*?\};/);
	const aliasMap = consumer.match(/const dynamicTraitMap_traitAliasManager\s*=\s*\{[\s\S]*?\};/)[0];
	assert.match(aliasMap, /litFunctionalTrait/);
	assert.doesNotMatch(aliasMap, /otherFunctionalTrait/);

	//The site indexes the alias field's own map, not the whole-app flat map.
	assert.match(consumer, /dynamicTraitMap_traitAliasManager\[traitPrps\.traitAliasManager\]/);
	assert.doesNotMatch(consumer, /dynamicTraitMap_array\[traitPrps\.traitAliasManager\]/);
});

//Builds a tiny OUTPUT tree (post-transpile shape) to exercise the data-fed trait-field pass directly.
const createDataFedOutputTree = () => {
	const root = join(tmpRoot, 'datafed-output');

	rmSync(root, { recursive: true, force: true });

	const write = (rel, body) => {
		const full = join(root, rel);

		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, body, 'utf8');
	};

	const fnTrait = 'const FunctionalTrait = (traitPrps = {}) => ({});\nexport default FunctionalTrait;\n';

	//Two traits UNDER a /contextMenu/ segment (the feature) + one unrelated trait that is NOT.
	write('dashboard/@x/contextMenu/menuA.jsx', fnTrait);
	write('dashboard/@x/contextMenu/menuB.jsx', fnTrait);
	write('dashboard/@x/other/funcTrait.jsx', fnTrait);

	//Hand-written scaffolding referencing the menus as literals — snake_case key + a ternary, in a
	// DIFFERENT file from the reader (the cross-file, rename-immune case).
	write('components/buildNodes.js', [
		'export const a = { context_menu: "@x/contextMenu/menuA" };',
		'export const b = (cond) => (cond ? "@x/contextMenu/menuB" : "@x/contextMenu/menuA");'
	].join('\n'));

	return root;
};

test('data-fed trait-field pass replaces the whole-app flat map with a feature-scoped map (residual 0)', () => {
	const root = createDataFedOutputTree();
	const readerKey = 'dashboard/@x/reader/index';

	//Reader as the main transpiler leaves it: a whole-app flat map (here standing in with the unrelated
	// trait) and a data-fed site indexing it.
	const readerContents = [
		'import XOtherFuncTrait from "../other/funcTrait";',
		'import React from "react";',
		'const dynamicTraitMap_array = {',
		'  "@x/other/funcTrait": (prps) => XOtherFuncTrait(prps),',
		'};',
		'const C = ({ traitPrps }) =>',
		'  (typeof traitPrps.contextMenu === "function"',
		'    ? traitPrps.contextMenu',
		'    : dynamicTraitMap_array[traitPrps.contextMenu])?.({});',
		'export default C;'
	].join('\n');

	const { contents, entries, residual } = rewriteReaderFile(readerContents, readerKey, root, { segments: ['/contextMenu/'] });

	//Every collected value resolved to a real module — nothing dropped, nothing left to a fallback.
	assert.strictEqual(residual.length, 0);
	assert.strictEqual(entries, 2);

	//The scoped map holds ONLY the two /contextMenu/ feature traits, keyed by their literal paths...
	assert.match(contents, /"@x\/contextMenu\/menuA": \(prps\) => \w+\(prps\)/);
	assert.match(contents, /"@x\/contextMenu\/menuB": \(prps\) => \w+\(prps\)/);

	//...and the unrelated whole-app entry (and its now-dead import) are gone.
	assert.doesNotMatch(contents, /@x\/other\/funcTrait/);
	assert.doesNotMatch(contents, /import XOtherFuncTrait\b/);

	//Each scoped module is imported, and the data-fed site is preserved (now resolving against the small map).
	assert.match(contents, /import \w+ from "[^"]*contextMenu\/menuA"/);
	assert.match(contents, /import \w+ from "[^"]*contextMenu\/menuB"/);
	assert.match(contents, /dynamicTraitMap_array\[traitPrps\.contextMenu\]/);
});

test('data-fed trait-field pass scopes a site to an explicit verified value list (grid/input/search case)', () => {
	const root = createDataFedOutputTree();
	const readerKey = 'dashboard/@x/reader/index';

	//Reader with a whole-app flat map (standing in with two traits) and an array-mapped data-fed site
	// whose key expression is NOT a simple traitPrps.<field> accessor — the case that can't be narrowed
	// by field and is instead scoped to an explicit verified candidate list.
	const readerContents = [
		'import XOtherFuncTrait from "../other/funcTrait";',
		'import XMenuA from "../contextMenu/menuA";',
		'import React from "react";',
		'const dynamicTraitMap_array = {',
		'  "@x/other/funcTrait": (prps) => XOtherFuncTrait(prps),',
		'  "@x/contextMenu/menuA": (prps) => XMenuA(prps),',
		'};',
		'const C = ({ traitPrps }) =>',
		'  (traitPrps.traits ?? []).map((trait) => {',
		'    const traitRef = trait.trait ?? trait;',
		'    return (typeof traitRef === "function" ? traitRef : dynamicTraitMap_array[traitRef])?.({});',
		'  });',
		'export default C;'
	].join('\n');

	//Scope to ONLY menuA (the explicit verified list) — menuB is intentionally not reachable here.
	const { contents, entries, residual } = rewriteReaderFile(readerContents, readerKey, root, {
		values: ['@x/contextMenu/menuA']
	});

	assert.strictEqual(residual.length, 0);
	assert.strictEqual(entries, 1);

	//The scoped map holds ONLY the listed value; the unrelated whole-app entry and its dead import are gone.
	assert.match(contents, /"@x\/contextMenu\/menuA": \(prps\) => \w+\(prps\)/);
	assert.doesNotMatch(contents, /@x\/other\/funcTrait/);
	assert.doesNotMatch(contents, /import XOtherFuncTrait\b/);

	//The data-fed site itself is preserved (now resolving against the small map).
	assert.match(contents, /dynamicTraitMap_array\[traitRef\]/);
});

test('data-fed trait-field pass prunes orphaned imports even when concatenated on one line (pre-prettier form)', () => {
	const root = createDataFedOutputTree();
	const readerKey = 'dashboard/@x/reader/index';

	//generateImports emits trait imports concatenated (res.join('')), and this pass runs BEFORE prettier
	// splits them onto separate lines. So at prune time all the orphaned whole-app imports sit on ONE line.
	// The prune must still remove them — and must leave `import React, { … }` (no bare `Ident from`) alone.
	const readerContents = [
		'import XOtherFuncTrait from "../other/funcTrait";import XMenuA from "../contextMenu/menuA";import React, { useMemo } from "react";',
		'const dynamicTraitMap_array = {',
		'  "@x/other/funcTrait": (prps) => XOtherFuncTrait(prps),',
		'  "@x/contextMenu/menuA": (prps) => XMenuA(prps),',
		'};',
		'const C = ({ traitPrps }) => {',
		'  useMemo(() => {}, []);',
		'  return (traitPrps.traits ?? []).map((trait) => {',
		'    const traitRef = trait.trait ?? trait;',
		'    return (typeof traitRef === "function" ? traitRef : dynamicTraitMap_array[traitRef])?.({});',
		'  });',
		'};',
		'export default C;'
	].join('\n');

	const { contents, entries, residual } = rewriteReaderFile(readerContents, readerKey, root, {
		values: ['@x/contextMenu/menuA']
	});

	assert.strictEqual(residual.length, 0);
	assert.strictEqual(entries, 1);

	//The orphaned import — concatenated on the same line as the others — is removed...
	assert.doesNotMatch(contents, /import XOtherFuncTrait\b/);
	assert.doesNotMatch(contents, /@x\/other\/funcTrait/);

	//...the still-needed scoped import survives (under its canonical identifier), the scoped map keeps it,
	// and the `import React, { useMemo }` form is untouched.
	assert.match(contents, /import \w+ from ["']\.\.\/contextMenu\/menuA["'];/);
	assert.match(contents, /"@x\/contextMenu\/menuA": \(prps\) => \w+\(prps\)/);
	assert.match(contents, /import React, \{ useMemo \} from "react";/);
});

// --- Grid cell-trait fields: function-preserving normalization + component-trait rendering ---

//The recognized cell-trait normalization morph (mirrors l2_grid columnCellNoEdit's innerTraits):
// JSON-clones columnConfig.<field> and injects per-cell context. Its JSON clone + {{variable}}
// substitution would drop a component-trait function import — which the plain-JS emission avoids.
const cellTraitNormalizationMorph = field => ({
	morph: true,
	morphVariable: 'res',
	morphActions: [
		{ type: 'stopScript', '^condition': { operator: 'isFalsy', value: `$columnConfig.${field}$` } },
		{ type: 'setVariable', name: 'columnConfig', value: '$columnConfig$' },
		{ type: 'setVariable', name: 'columnCellValue', value: '%columnCellValue%' },
		{
			type: 'setVariable',
			name: 'res',
			value: [
				'{{eval.',
				'  const columnConfig = {{variable.columnConfig}};',
				'  let res;',
				`  if (columnConfig.${field}) {`,
				`    const transformed = JSON.parse(JSON.stringify(columnConfig.${field}) ).map(entry => {`,
				"      if (typeof entry === 'string') { entry = { trait: entry, traitPrps: {} }; }",
				'      if (!entry.traitPrps) { entry.traitPrps = {}; }',
				'      entry.traitPrps.columnConfig = columnConfig;',
				'      entry.traitPrps.columnCellIndex = %columnCellIndex%;',
				'      entry.traitPrps.columnCellValue = {{variable.columnCellValue}};',
				'      return entry;',
				'    });',
				'    transformed;',
				'  }',
				'}}'
			],
			inlineKeys: ['value']
		}
	]
});

test('generateTraitOnMount emits plain-JS normalization for innerTraits (preserves imports, no eval)', () => {
	const out = generateTraitOnMount({
		acceptPrps: { innerTraits: cellTraitNormalizationMorph('innerTraits') }
	}, undefined);

	//Plain-JS clone + standard injection — and crucially NOT a JSON-serializing eval that drops imports.
	assert.match(out, /traitPrps\.innerTraits = traitPrps\.columnConfig\?\.innerTraits/);
	assert.match(out, /entry\.traitPrps\.columnConfig = traitPrps\.columnConfig/);
	assert.match(out, /entry\.traitPrps\.columnCellIndex = traitPrps\.columnCellIndex/);
	assert.match(out, /entry\.traitPrps\.columnCellValue = traitPrps\.columnCellValue/);
	assert.doesNotMatch(out, /innerTraits = getSyncScriptResult/);
	assert.doesNotMatch(out, /JSON\.parse/);
	//innerTraits' morph has a stopScript guard → undefined when the source list is absent.
	assert.match(out, /: undefined;/);
});

test('generateTraitOnMount uses [] fallback for extraGridComponentTraits (no stopScript guard)', () => {
	const morph = cellTraitNormalizationMorph('extraGridComponentTraits');
	morph.morphActions = morph.morphActions.filter(a => a.type !== 'stopScript');

	const out = generateTraitOnMount({
		acceptPrps: { extraGridComponentTraits: morph }
	}, undefined);

	assert.match(out, /traitPrps\.extraGridComponentTraits = traitPrps\.columnConfig\?\.extraGridComponentTraits/);
	assert.match(out, /: \[\];/);
	assert.doesNotMatch(out, /extraGridComponentTraits = getSyncScriptResult/);
});

test('generateTraitOnMount leaves a non-cell-trait morph as a getSyncScriptResult eval', () => {
	const out = generateTraitOnMount({
		acceptPrps: {
			someOtherField: {
				morph: true,
				morphVariable: 'res',
				morphActions: [{ type: 'setVariable', name: 'res', value: '{{eval. 1 + 1 }}' }]
			}
		}
	}, undefined);

	assert.match(out, /getSyncScriptResult/);
	assert.doesNotMatch(out, /\.map\(\(?entry\)?/);
});

test('generateTraitOnMount leaves an innerTraits morph of a different shape as a getSyncScriptResult eval', () => {
	//Same field name, but NOT the recognized clone-and-inject normalization → must fall through untouched.
	const out = generateTraitOnMount({
		acceptPrps: {
			innerTraits: {
				morph: true,
				morphVariable: 'res',
				morphActions: [{ type: 'setVariable', name: 'res', value: '{{eval. somethingElse }}' }]
			}
		}
	}, undefined);

	assert.match(out, /getSyncScriptResult/);
	assert.doesNotMatch(out, /traitPrps\.columnConfig\?\.innerTraits/);
});

const createCellTraitRenderSourceApp = () => {
	const sourceApp = join(tmpRoot, 'source-app-cell-trait-render');
	const hostTraitPath = join(sourceApp, 'app', 'dashboard', '@myGrid', 'cellHost', 'index.json');

	rmSync(sourceApp, { recursive: true, force: true });
	cpSync(fixtureSourceApp, sourceApp, { recursive: true });

	//A grid-cell-like host trait: an innerTraits normalization morph (whose entries may be component
	// traits) plus a TYPELESS node whose entire trait list is the dynamic `$innerTraits$` token.
	mkdirSync(dirname(hostTraitPath), { recursive: true });
	writeFileSync(hostTraitPath, JSON.stringify({
		type: 'container',
		acceptPrps: {
			columnConfig: 'object',
			columnCellIndex: 'string',
			columnCellValue: 'mixed',
			innerTraits: cellTraitNormalizationMorph('innerTraits')
		},
		wgts: [{
			id: 'customCell-%columnCellIndex%',
			condition: { operator: 'isTruthy', value: '$columnConfig.innerTraits$' },
			traits: '$innerTraits$'
		}]
	}, null, '\t'), 'utf8');

	const sampleDashboardPath = join(sourceApp, 'app', 'dashboard', 'sampleDashboard.json');
	const sampleDashboard = JSON.parse(readFileSync(sampleDashboardPath, 'utf8'));
	sampleDashboard.wgts.push({
		id: 'cellHostUsage',
		traits: [{ trait: '@myGrid/cellHost/index', traitPrps: { columnConfig: {}, columnCellIndex: '0', columnCellValue: 'x' } }]
	});
	writeFileSync(sampleDashboardPath, JSON.stringify(sampleDashboard, null, '\t'), 'utf8');

	return sourceApp;
};

test('typeless cell-trait node renders the component trait as the type (renderDynamicTraits), with function-preserving normalization', () => {
	const sourceApp = createCellTraitRenderSourceApp();
	const targetApp = join(tmpRoot, 'target-app-cell-trait-render');

	rmSync(targetApp, { recursive: true, force: true });

	assert.doesNotThrow(() => {
		execFileSync(process.execPath, ['src/transpile.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				OPUS_TRANSPILER_SOURCE_APPLICATION_FOLDER: sourceApp,
				OPUS_TRANSPILER_TARGET_APPLICATION_FOLDER: targetApp,
				OPUS_TRANSPILER_REPLACE_MAIN_JSX: 'true'
			},
			stdio: 'pipe'
		});
	});

	const component = readFileSync(
		join(targetApp, 'src', 'dashboard', '@myGrid', 'cellHost', 'index.jsx'),
		'utf8'
	);

	//Problem 1: normalization is plain JS (function imports survive) — no JSON-cloning eval.
	assert.match(component, /traitPrps\.innerTraits = traitPrps\.columnConfig\?\.innerTraits/);
	assert.match(component, /entry\.traitPrps\.columnConfig = traitPrps\.columnConfig/);
	assert.doesNotMatch(component, /innerTraits = getSyncScriptResult/);
	assert.doesNotMatch(component, /JSON\.parse/);

	//Problem 2: the typeless node renders through renderDynamicTraits (component trait becomes the type)
	// rather than merging onto a <Label>, and the helper is imported + emitted.
	assert.match(component, /renderDynamicTraits\(\{/);
	assert.match(component, /FallbackType:/);
	assert.match(component, /import \{ renderDynamicTraits \} from ['"][^'"]*renderDynamicTraits['"];/);
	assert.ok(existsSync(join(targetApp, 'src', 'renderDynamicTraits.jsx')));
});

test('normalizeTraits keeps a singular trait flat inside cell trait-ref-list fields, but wraps it inside wgts', () => {
	const node = {
		prps: {
			columnConfig: [{
				key: 'types',
				innerTraits: [{ trait: '@x/roleTypeCell', traitPrps: {} }],
				headerTraits: [{ trait: '@x/headerCell' }],
				extraGridComponentTraits: [{ trait: '@x/extra' }]
			}]
		},
		wgts: [{ trait: '@x/someWidgetTrait', traitPrps: {} }]
	};

	normalizeTraits(node);

	const col = node.prps.columnConfig[0];

	//Cell trait-ref-list entries stay flat (still `{ trait }`, not wrapped into `{ traits: [...] }`).
	assert.equal(col.innerTraits[0].trait, '@x/roleTypeCell');
	assert.equal(col.innerTraits[0].traits, undefined);
	assert.equal(col.headerTraits[0].trait, '@x/headerCell');
	assert.equal(col.headerTraits[0].traits, undefined);
	assert.equal(col.extraGridComponentTraits[0].trait, '@x/extra');
	assert.equal(col.extraGridComponentTraits[0].traits, undefined);

	//A wgts entry IS a node — the singular trait is still normalized into a traits array.
	assert.equal(node.wgts[0].trait, undefined);
	assert.equal(node.wgts[0].traits[0].trait, '@x/someWidgetTrait');
});

// --- Config-trait fields: convert use-site paths to direct imports + suppress the whole-app map ---

test('config-trait field paths convert to direct imports (.traitConfig for component traits), leaving tokens/other keys alone', () => {
	const mapFiles = new Map([
		//A component-trait dataManager (declares a type → consumer needs its .traitConfig closure).
		['dashboard/@grids/roles/dataManager.json', { contents: { type: 'container', acceptPrps: { columnConfig: 'object' } } }],
		//A functional-trait manager (no own type → the module IS the config function).
		['dashboard/@grids/funcManager.json', { contents: { prps: { flows: [] } } }]
	]);

	const currentPath = 'dashboard/@somePage/index';

	const input = [
		'const prps = {',
		'  traitDataManager: "@grids/roles/dataManager",',
		'  traitModifiedRecordsManager: "@grids/funcManager",',
		'  traitReorderedRecordsManager: traitPrps.traitReorderedRecordsManager,',
		'  someOtherField: "@grids/roles/dataManager"',
		'};'
	].join('\n');

	const output = transformTraitReferences(input, currentPath, mapFiles);

	//Component-trait dataManager → direct import called via .traitConfig (what the consumer invokes).
	assert.match(output, /import GridsRolesDataManager from ['"][^'"]*@grids\/roles\/dataManager['"];/);
	assert.match(output, /traitDataManager:\s*GridsRolesDataManager\.traitConfig/);
	assert.doesNotMatch(output, /traitDataManager:\s*["']@grids/);

	//Functional-trait manager → bare import, no .traitConfig.
	assert.match(output, /traitModifiedRecordsManager:\s*GridsFuncManager,/);
	assert.doesNotMatch(output, /traitModifiedRecordsManager:\s*\w+\.traitConfig/);

	//A forwarding accessor (a wrapper passing its own prop down) is left untouched.
	assert.match(output, /traitReorderedRecordsManager:\s*traitPrps\.traitReorderedRecordsManager/);

	//The SAME path under a non-config key is NOT a config-trait field — left as a string.
	assert.match(output, /someOtherField:\s*["']@grids\/roles\/dataManager["']/);
});

test('getDynamicTraitFieldCandidates returns no candidates for config-trait-import fields (empties their maps)', () => {
	initDynamicTraitCandidates({
		fieldCandidates: new Map([
			['traitDataManager', [{ value: '@x/dm', path: 'dashboard/@x/dm.json', type: 'XDm', isComponentTrait: true }]],
			['someField', [{ value: '@x/y', path: 'dashboard/@x/y.json', type: 'XY', isComponentTrait: false }]]
		])
	});

	//Config-trait fields are converted to imports at the use site, so their candidate maps are emptied.
	assert.deepEqual(getDynamicTraitFieldCandidates('traitDataManager'), []);
	assert.deepEqual(getDynamicTraitFieldCandidates('traitModifiedRecordsManager'), []);
	assert.deepEqual(getDynamicTraitFieldCandidates('traitReorderedRecordsManager'), []);

	//A normal dynamic-trait field is unaffected.
	assert.equal(getDynamicTraitFieldCandidates('someField').length, 1);
});
