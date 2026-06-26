import assert from 'node:assert/strict';
import { test } from 'node:test';

//The runtime trait appliers can't be imported whole in plain node (the Opus UI module graph needs
// the vite resolver — extensionless imports, rxjs, DOM helpers). getTranspiledTraitFn is the pure,
// dependency-free heart of the function-valued-trait handling (Fix 4): it decides whether a trait
// entry is a transpiled module imported directly (a function) or a legacy path/inline reference. It
// is the contract between transpiler output and the runtime, so it is worth pinning down directly.
import getTranspiledTraitFn from '../../packages/@intenda/opus-ui/src/system/managers/traitManager/getTranspiledTraitFn.js';

const functionalTrait = () => ({ prps: { flex: true } });

const componentTrait = () => null;
componentTrait.isTranspiledComponent = true;

test('getTranspiledTraitFn returns the function for the { trait: fn } shape (catch-all/MDA imports)', () => {
	assert.equal(getTranspiledTraitFn({ trait: functionalTrait, traitPrps: {} }), functionalTrait);
	assert.equal(getTranspiledTraitFn({ trait: componentTrait }), componentTrait);
});

test('getTranspiledTraitFn returns the function for the { type: fn } shape (render-MDA imports)', () => {
	assert.equal(getTranspiledTraitFn({ type: functionalTrait, traitPrps: {} }), functionalTrait);
	assert.equal(getTranspiledTraitFn({ type: componentTrait }), componentTrait);
});

test('getTranspiledTraitFn returns a bare function trait', () => {
	assert.equal(getTranspiledTraitFn(functionalTrait), functionalTrait);
});

test('getTranspiledTraitFn returns null for legacy references the runtime resolves itself', () => {
	//Path strings (resolved via getTrait), inline trait-mda objects, data tokens, and empties.
	assert.equal(getTranspiledTraitFn({ trait: 'traits/menu/menuAction' }), null);
	assert.equal(getTranspiledTraitFn('traits/menu/menuAction'), null);
	assert.equal(getTranspiledTraitFn({ type: { acceptPrps: {}, traitArray: [] } }), null);
	assert.equal(getTranspiledTraitFn({ trait: '{{rowData.trait}}' }), null);
	assert.equal(getTranspiledTraitFn(null), null);
	assert.equal(getTranspiledTraitFn(undefined), null);
});
