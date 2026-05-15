import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, test } from 'node:test';

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
	assert.match(targetedTokenTrait, /cpt:\s*`Hello \$\{getDeepProperty\(traitPrps, ["']caption["']\)\} from \$\{getDeepProperty\(traitPrps, ["']details\.name["']\)\}`/);
	assert.match(targetedTokenTrait, /color:\s*traitPrps\.color/);
	assert.doesNotMatch(targetedTokenTrait, /"%caption%"/);
	assert.doesNotMatch(targetedTokenTrait, /"\$color\$"/);
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

	assert.match(contents, /if \(\$\{getDeepProperty\(traitPrps, ["']flag["']\)\}\)/);
	assert.match(contents, /res\.width = \$\{getThemeValue\(["']colors\.primary["']\)\};/);
	assert.doesNotMatch(contents, /\$flag\$/);
});
