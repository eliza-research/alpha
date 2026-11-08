import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {modelStateInventory,unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';

function fixture(run){
  const directory=mkdtempSync(join(tmpdir(),'quint-state-inventory-'));
  try{run(directory);}finally{rmSync(directory,{recursive:true,force:true});}
}

test('state inventory follows aliases, nested records and primitive or collection variables',()=>fixture(directory=>{
  const path=join(directory,'State.qnt');
  writeFileSync(path,`module State {
    type Detail = { present: bool, amount: int }
    type Coordinator = { pending: Detail, slots: int -> Detail }
    var s: Coordinator
    var revision: int
    action init = all { s' = {pending: {present: false, amount: 0}, slots: Map()}, revision' = 0 }
  }`);
  const inventory=modelStateInventory(path,'State');
  assert.deepEqual(inventory.variables,['revision','s']);
  assert.deepEqual(inventory.fields,['revision','s.pending.amount','s.pending.present','s.slots']);
  assert.deepEqual(inventory.actions,['init']);
  assert.deepEqual(unobservedStateFields(inventory,['s.pending','revision']),['s.slots']);
  assert.deepEqual(unobservedStateFields(inventory,['pending','s.pending.present']),['revision','s.pending.amount','s.slots']);
}));

test('state inventory preserves separate imported instance ownership',()=>fixture(directory=>{
  writeFileSync(join(directory,'Child.qnt'),'module Child { type Entry = { phase: str } var s: Entry }');
  const path=join(directory,'Main.qnt');
  writeFileSync(path,`module Wrapper { const instance: int import Child.* from "./Child" }
    module Main { import Wrapper(instance = 1) as First import Wrapper(instance = 2) as Second var ready: bool }`);
  const inventory=modelStateInventory(path,'Main');
  assert.deepEqual(inventory.variables,['First::s','Second::s','ready']);
  assert.deepEqual(inventory.fields,['First::s.phase','Second::s.phase','ready']);
  assert.deepEqual(unobservedStateFields(inventory,['First::s']),['Second::s.phase','ready']);
}));

test('state inventory excludes unselected imports and accepts selected imported types',()=>fixture(directory=>{
  writeFileSync(join(directory,'Child.qnt'),'module Child { type Detail = { value: int } var hidden: bool pure val constant = 1 }');
  const path=join(directory,'Main.qnt');
  writeFileSync(path,`module Main { import Child.constant from "./Child" import Child.Detail from "./Child" var entry: Detail }`);
  assert.deepEqual(modelStateInventory(path,'Main').fields,['entry.value']);
}));

test('state inventory rejects malformed declarations and missing modules',()=>fixture(directory=>{
  const path=join(directory,'Bad.qnt');writeFileSync(path,'module Bad { var }');
  assert.throws(()=>modelStateInventory(path,'Bad'),/Cannot inventory/);
  writeFileSync(path,'module Good { var flag: bool }');
  assert.throws(()=>modelStateInventory(path,'Missing'),/Missing Quint module/);
}));

test('state inventory refuses to invent a mapping for overridden state variables',()=>fixture(directory=>{
  const path=join(directory,'Override.qnt');
  writeFileSync(path,'module Child { var flag: bool } module Main { import Child(flag = true) as C }');
  assert.throws(()=>modelStateInventory(path,'Main'),/Variable override needs an explicit state mapping/);
}));
