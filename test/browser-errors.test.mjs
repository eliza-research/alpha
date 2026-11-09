import assert from 'node:assert/strict';
import test from 'node:test';
import {CapacitorException,ExceptionCode} from '@capacitor/core';
import {browserErrorMessage} from '../apps/app/src/browser/browser-errors.ts';

test('only a genuine Capacitor unimplemented exception becomes plain Browser copy',()=>{
 const error=new CapacitorException('"AlphaBrowser" plugin is not implemented on android',ExceptionCode.Unimplemented);
 assert.equal(browserErrorMessage(error),'This feature isn’t available in this version of Alpha.');
});
test('unavailable, unrelated and lookalike errors are not reclassified',()=>{
 for(const error of [new CapacitorException('Check the connection.',ExceptionCode.Unavailable),Object.assign(new Error('Keep this error'),{code:'UNIMPLEMENTED'}),new Error('"AlphaBrowser" plugin is not implemented on android'),new Error('Saved bookmarks need recovery. Open Bookmarks to recover them.')])assert.equal(browserErrorMessage(error),error.message);
 assert.equal(browserErrorMessage(null),'Browser unavailable');
});
