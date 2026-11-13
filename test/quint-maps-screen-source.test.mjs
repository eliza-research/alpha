import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkMapsScreenModes,checkMapsNavigationGuidanceReadback} from '../specs/quint/refinement/services/maps-screen-source.mjs';
test('actual Maps screen layers refine the bounded modes projection',{timeout:scaledTimeout(600000)},async()=>{const {receipt}=await checkMapsScreenModes();assert.equal(receipt.passed,true);assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.traces,3);assert.ok(receipt.checkpoints>=25);});
test('actual Maps guidance and readback refine bounded route/session schedules',{timeout:scaledTimeout(600000)},async()=>{const {receipt}=await checkMapsNavigationGuidanceReadback();assert.equal(receipt.passed,true);assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.traces,8);assert.ok(receipt.checkpoints>=40);});
test('screen source canary detects Back retaining selected place',{timeout:scaledTimeout(600000)},async()=>{await assert.rejects(checkMapsScreenModes([],{mutant:'keep-place-after-back'}),/Back must retire selected-place layer|Source\/model trace mismatch/);});
test('guidance source canary detects End retaining guidance',{timeout:scaledTimeout(600000)},async()=>{await assert.rejects(checkMapsNavigationGuidanceReadback([],{mutant:'keep-guidance-after-end'}),/End must clear actual guidance readback|Source\/model trace mismatch/);});
test('guidance source canary detects a view switch ending guidance',{timeout:scaledTimeout(600000)},async()=>{await assert.rejects(checkMapsNavigationGuidanceReadback([],{mutant:'end-guidance-on-view-leave'}),/A view switch must keep|Source\/model trace mismatch/);});
