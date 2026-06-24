import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, test } from 'node:test';

import { transformTraitReferences } from '../src/builders/scriptAction.mjs';

const outputRoot = resolve('output');
const outputSrc = join(outputRoot, 'src');
const fixtureSourceApp = resolve('tests', 'fixtures', 'source-app');
const tmpRoot = resolve('tests', '.tmp');
const fixtureTargetApp = join(tmpRoot, 'target-app');

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

before(() => {
	rmSync(outputRoot, { recursive: true, force: true });
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
		.filter(file => basename(file) !== 'dynamicTraits.jsx')
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
	const dynamicTraitsRegistry = readFileSync(join(outputSrc, 'dynamicTraits.jsx'), 'utf8');

	assert.match(dashboard, /<TraitsDynamicContainerTrait\s+id="dynamicTraitComponent"[\s\S]*traitPrps=\{\{ dynamicTrait: "traits\/dynamic\/dataTrait" \}\}/);
	assert.match(dashboard, /<TraitsDynamicArrayContainerTrait\s+id="dynamicTraitArrayComponent"[\s\S]*traitPrps=\{\{\s*traits:\s*\[/);
	assert.match(dynamicTrait, /import \{ resolveDynamicTrait \} from ["']\.\.\/\.\.\/\.\.\/dynamicTraits["'];/);
	assert.match(dynamicTrait, /TraitsStaticStaticFunctionalTrait\(\{\}\)/);
	assert.match(dynamicTrait, /resolveDynamicTrait\(traitPrps\.dynamicTrait\)\?\.\(\{\}\)/);
	assert.doesNotMatch(dynamicTrait, /%dynamicTrait%/);
	assert.match(dynamicArrayTrait, /import \{ resolveDynamicTrait \} from ["']\.\.\/\.\.\/\.\.\/dynamicTraits["'];/);
	assert.match(dynamicArrayTrait, /\.\.\.\(traitPrps\.traits \?\? \[\]\)\.map\(/);
	assert.match(dynamicArrayTrait, /resolveDynamicTrait\(.*(?:trait\.trait|traitPath).*?\)\?\.\(.*(?:trait\.traitPrps|traitPrps).*?\)/s);
	assert.doesNotMatch(dynamicArrayTrait, /resolveDynamicTrait\(traitPrps\.\)\?\.\(\{\}\)/);
	assert.match(dynamicTraitsRegistry, /import TraitsDynamicDataTrait from ["']\.\/dashboard\/traits\/dynamic\/dataTrait["'];/);
	assert.match(dynamicTraitsRegistry, /["']traits\/dynamic\/dataTrait["']:\s*TraitsDynamicDataTrait/);
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
	assert.equal(result.prps.label, 'Trait');
	assert.equal(result.prps.visible, true);
	assert.deepEqual(result.prps.scps, [{ id: 'baseAction' }, { id: 'traitAction' }]);
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

test('transpiler preserves existing target src themes by default', () => {
	const preserveTargetApp = join(tmpRoot, 'target-app-preserve-themes');
	const preservedTheme = join(preserveTargetApp, 'src', 'themes', 'colors.jsx');
	const customTheme = 'const Theme = { colors: { primary: "custom" } };\nexport default Theme;\n';

	rmSync(preserveTargetApp, { recursive: true, force: true });
	mkdirSync(dirname(preservedTheme), { recursive: true });
	writeFileSync(preservedTheme, customTheme, 'utf8');

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

	assert.equal(readFileSync(preservedTheme, 'utf8'), customTheme);
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
	assert.match(dashboard, /import \{ resolveDynamicTrait \} from ["']\.\.\/dynamicTraits["'];/);
	assert.match(dashboard, /traits:\s*"{{rowData\.traits}}"/);
	assert.match(dashboard, /resolveDynamicTrait:\s*resolveDynamicTrait/);
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

	//The component's own `traits: [{ trait }]` array is handled by the component-trait pass: this
	// reference is a functional trait, so it is intentionally left as a string there.
	assert.match(output, /traits:\s*\[\{\s*trait:\s*["']@menu\/tree\/functional\/setBg["']\s*\}\]/);
});
