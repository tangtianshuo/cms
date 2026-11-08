import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isRequiredNumberMissing,
    requiredNumbersAreComplete,
} from '../src/util/required-number.ts';

test('required numbers accept zero, negative and non-zero values', () => {
    for (const value of [0, -1, 1, -0.5, 12.75]) {
        assert.equal(isRequiredNumberMissing(value), false);
    }
    assert.equal(requiredNumbersAreComplete([0, -1, 5]), true);
});

test('required numbers reject absent, empty and NaN values', () => {
    for (const value of [undefined, null, '', '   ', Number.NaN]) {
        assert.equal(isRequiredNumberMissing(value), true);
    }
    assert.equal(requiredNumbersAreComplete([]), false);
    assert.equal(requiredNumbersAreComplete([1, null]), false);
});
