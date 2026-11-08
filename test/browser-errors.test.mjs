import assert from 'node:assert/strict';
import test from 'node:test';
import {CapacitorException,ExceptionCode} from '@capacitor/core';
import {browserErrorMessage} from '../apps/app/src/browser/browser-errors.ts';

test('only a genuine Capacitor unimplemented exception becomes plain Browser copy',()=>{
 const error=new CapacitorException('"AlphaBrowser" plugin is not implemented on android',ExceptionCode.Unimplemented);
 assert.equal(browserErrorMessage(error),'This feature isn’t available in this version of Alpha.');
});
test('Browser recovery and capability instructions remain exact',()=>{
 for(const message of ['Saved bookmarks need recovery. Open Bookmarks to recover them.','Saved tabs and history could not be opened. They were kept unchanged; Clear browsing data resets them.','Reading unavailable on a sensitive or unverified page'])assert.equal(browserErrorMessage(new Error(message)),message);
});
test('the native isolated-profile refusal becomes plain WebView guidance',()=>{
 assert.equal(browserErrorMessage(new Error('This Android WebView does not support isolated browser profiles')),'Alpha Browser needs a newer Android System WebView. Update it, or use another browser.');
});
test('unavailable, unrelated and lookalike errors are not reclassified',()=>{
 for(const error of [new CapacitorException('Check the connection.',ExceptionCode.Unavailable),Object.assign(new Error('Keep this error'),{code:'UNIMPLEMENTED'}),new Error('"AlphaBrowser" plugin is not implemented on android')])assert.equal(browserErrorMessage(error),error.message);
 assert.equal(browserErrorMessage(null),'Browser unavailable');
});
