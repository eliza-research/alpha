import {readFileSync} from 'node:fs';
import {dirname,resolve,extname} from 'node:path';
import {newIdGenerator} from '@informalsystems/quint/dist/src/idGenerator.js';
import {parsePhase1fromText} from '@informalsystems/quint/dist/src/parsing/quintParserFrontend.js';

/** Read state declarations from Quint's syntax tree, including imported instances. */
export function modelStateInventory(modelPath,moduleName){
  const files=new Map();
  function moduleAt(path,name){
    const absolute=resolve(path);
    if(!files.has(absolute)){
      const parsed=parsePhase1fromText(newIdGenerator(),readFileSync(absolute,'utf8'),absolute);
      if(parsed.errors.length)throw Error(`Cannot inventory Quint state in ${absolute}: ${parsed.errors.map(error=>error.message).join(', ')}`);
      files.set(absolute,new Map(parsed.modules.map(module=>[module.name,module])));
    }
    const module=files.get(absolute).get(name);
    if(!module)throw Error(`Missing Quint module ${name} in ${absolute}`);
    return {path:absolute,module};
  }
  function imported(context,declaration){
    const source=declaration.fromSource;
    const path=source?resolve(dirname(context.path),extname(source)?source:source+'.qnt'):context.path;
    return moduleAt(path,declaration.protoName);
  }
  function typeNamed(context,name,seen=new Set()){
    const key=context.path+'#'+context.module.name+'#'+name;
    if(seen.has(key))return null;
    seen.add(key);
    const own=context.module.declarations.find(declaration=>declaration.kind==='typedef'&&declaration.name===name);
    if(own)return own.type?{context,type:own.type}:null;
    for(const declaration of context.module.declarations.filter(item=>item.kind==='import')){
      if(declaration.defName==='*'||declaration.defName===name){
        const found=typeNamed(imported(context,declaration),name,seen);
        if(found)return found;
      }
    }
    return null;
  }
  function recordFields(context,type,path,seen=new Set()){
    if(type.kind==='const'){
      const key=context.path+'#'+context.module.name+'#'+type.name;
      const found=seen.has(key)?null:typeNamed(context,type.name);
      if(found)return recordFields(found.context,found.type,path,new Set([...seen,key]));
    }
    if(type.kind!=='rec')return [path];
    const result=[];
    let row=type.fields;
    while(row.kind==='row'){
      for(const field of row.fields)result.push(...recordFields(context,field.fieldType,path+'.'+field.fieldName,seen));
      row=row.other;
    }
    if(row.kind!=='empty')result.push(path);
    return result.length?result:[path];
  }
  function declarations(context,prefix='',stack=new Set()){
    const key=context.path+'#'+context.module.name;
    if(stack.has(key))throw Error(`Cyclic state import at ${key}`);
    const next=new Set([...stack,key]),variables=[],fields=[];
    for(const declaration of context.module.declarations){
      if(declaration.kind==='var'){
        const path=prefix+declaration.name;
        variables.push(path);fields.push(...recordFields(context,declaration.typeAnnotation,path));
      }
      if(declaration.kind==='instance'||declaration.kind==='import'){
        const scope=declaration.qualifiedName?declaration.qualifiedName+'::':'';
        const child=declarations(imported(context,declaration),prefix+scope,next);
        for(const [parameter] of declaration.overrides||[]){
          if(child.variables.includes(prefix+scope+parameter.name))throw Error(`Variable override needs an explicit state mapping for ${parameter.name}`);
        }
        const selected=declaration.kind==='import'&&declaration.defName&&declaration.defName!=='*'
          ? child.variables.filter(path=>path===prefix+declaration.defName):child.variables;
        variables.push(...selected);
        fields.push(...child.fields.filter(field=>selected.some(path=>field===path||field.startsWith(path+'.'))));
      }
    }
    return {variables,fields};
  }
  const context=moduleAt(modelPath,moduleName),inventory=declarations(context);
  const actions=context.module.declarations.filter(declaration=>declaration.kind==='def'&&declaration.qualifier==='action').map(declaration=>declaration.name);
  return {variables:[...new Set(inventory.variables)].sort(),fields:[...new Set(inventory.fields)].sort(),actions};
}

/** An exact record observation covers its fields. A derived projection has its own name. */
export function unobservedStateFields(inventory,observations){
  return inventory.fields.filter(field=>!observations.some(observed=>field===observed||field.startsWith(observed+'.')));
}

export function traceActionCoverage(receipts) {
  const initializers = new Set();
  const transitions = new Set();
  const rejections = new Set();
  for (const receipt of receipts) {
    for (const trace of receipt.traceInputs) {
      initializers.add(trace.init?.name || 'init');
      for (const step of trace.steps || []) {
        if (!step.action) continue;
        const actions = Array.isArray(step.action) ? step.action : [step.action];
        for (const action of actions) {
          const observed = action.reject ? rejections : transitions;
          observed.add(action.name);
        }
      }
    }
  }
  return {
    modelInitializers: [...initializers].sort(),
    modelActions: [...new Set([...transitions, ...rejections])].sort(),
    modelTransitionActions: [...transitions].sort(),
    modelRejectedActions: [...rejections].sort(),
  };
}
