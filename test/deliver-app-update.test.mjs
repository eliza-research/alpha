import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deliver, publicObject} from '../scripts/deliver-app-update.ts';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stableTag = 'app-stable-alphacompute';
const legacyTag = 'app-stable';
const manifestUrl = `https://github.com/alphacompute/alpha/releases/download/${stableTag}/alpha-update-stable.json`;
const legacyManifestUrl = `https://github.com/alphacompute/alpha/releases/download/${legacyTag}/alpha-update-stable.json`;
const source = '1'.repeat(40);
const object = bytes => ({bytes: Buffer.from(bytes), size: Buffer.byteLength(bytes), sha256: sha(bytes)});
function fixture(t, {previous = null, legacyPrevious = null, legacyAssets = [], isPrivate = false, repoId = 1396333361, releaseMissing = false, apkWrong = false, pointerRace = false, manifestInvisible = false} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-delivery-test-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const apkBytes = Buffer.from('synthetic qualified release bytes');
  const offer = {schema:'alpha-update/v1',versionCode:8,versionName:'0.1.8',variant:'launcher',signerSha256:'a'.repeat(64),
    apkUrl:new URL('alpha-phone-8.apk',manifestUrl).href,sha256:sha(apkBytes),sizeBytes:apkBytes.length};
  const manifestBytes = Buffer.from(JSON.stringify(offer)+'\n');
  fs.writeFileSync(path.join(directory,'alpha-update-stable.json'),manifestBytes);
  fs.writeFileSync(path.join(directory,'alpha-phone-8.apk'),apkBytes);
  const events = [], uploads = [];
  const retained = (url, previous) => {
    if (previous === null) return null;
    const versionCode = previous.versionCode ?? 7;
    return object(JSON.stringify({...offer,versionCode,apkUrl:new URL(`alpha-phone-${versionCode}.apk`,url).href,...previous})+'\n');
  };
  let pointer = retained(manifestUrl, previous);
  const legacyPointer = retained(legacyManifestUrl, legacyPrevious);
  let apkVisible = false, pointerReads = 0, releaseExists = !releaseMissing;
  const ports = {
    wait: async () => {},
    run(args) {
      events.push(args.slice(0,2).join(' '));
      if (args[0] === 'api') {
        assert.deepEqual(args,['api','repos/alphacompute/alpha']);
        return JSON.stringify({id:repoId,full_name:'alphacompute/alpha',private:isPrivate});
      }
      if (args[1] === 'view') {
        if (args[2] === legacyTag) return legacyPointer || legacyAssets.length ? JSON.stringify({isDraft:false,assets:legacyAssets}) : null;
        assert.equal(args[2],stableTag);
        if (!releaseExists) return null;
        const assets = [];
        if (apkVisible) assets.push({name:'alpha-phone-8.apk'});
        if (pointer) assets.push({name:'alpha-update-stable.json'});
        return JSON.stringify({isDraft:false,assets});
      }
      if (args[1] === 'create' || args[1] === 'upload') assert.equal(args[2],stableTag);
      if (args[1] === 'create') releaseExists = true;
      if (args[1] === 'upload') {
        const name = path.basename(args[3]);
        uploads.push(name);
        if (name.endsWith('.apk')) {assert.equal(args.includes('--clobber'),false); apkVisible = true;}
        else {
          assert.equal(apkVisible,true,'manifest cannot be published before APK');
          assert.ok(events.includes('apk readback'),'anonymous APK proof precedes manifest');
          if (!manifestInvisible) pointer = object(manifestBytes);
        }
      }
      return '';
    },
    async read(url) {
      if (url === legacyManifestUrl) {
        events.push('retired manifest read');
        return legacyPointer;
      }
      if (url === manifestUrl) {
        events.push('manifest readback');
        pointerReads++;
        if (pointerRace && pointerReads === 2) return object(JSON.stringify({...offer,versionCode:9}));
        return pointer;
      }
      assert.equal(url,offer.apkUrl);
      events.push('apk readback');
      if (!apkVisible) throw Error('not uploaded');
      return object(apkWrong ? 'corrupt bytes' : apkBytes);
    },
  };
  return {directory,manifestUrl,source,ports,events,uploads,offer,manifestBytes};
}

test('delivery proves anonymous APK bytes before moving and reading back the stable manifest',async t => {
  const formerLegacyApk = new URL('alpha-phone-7.apk',legacyManifestUrl.replace('/alpha/','/alphaphone/')).href;
  const f = fixture(t,{legacyPrevious:{apkUrl:formerLegacyApk},releaseMissing:true});
  const receipt = await deliver(f,f.ports);
  assert.deepEqual(f.uploads,['alpha-phone-8.apk','alpha-update-stable.json']);
  assert.ok(f.events.indexOf('release create') < f.events.indexOf('release upload'));
  assert.ok(f.events.indexOf('retired manifest read') < f.events.indexOf('release create'));
  assert.deepEqual(receipt,{schema:'alpha-app-update-delivery/v1',publisherCommit:source,sourceScope:'publication-tooling-only',variant:'launcher',versionCode:8,
    apkSha256:f.offer.sha256,manifestSha256:sha(f.manifestBytes),anonymousReadback:true});
});

test('retired-channel versions remain reserved and its pointer cannot be published',async t => {
  for (const options of [{legacyPrevious:{versionCode:8}}, {legacyAssets:[{name:'alpha-phone-9.apk'}]},
    {legacyAssets:[{name:'alpha-update-stable.json'}]}]) {
    const f = fixture(t,options);
    await assert.rejects(deliver(f,f.ports),/version floor|not publicly readable/);
    assert.deepEqual(f.uploads,[]);
    assert.ok(!f.events.includes('release create'));
  }
  const f = fixture(t);
  await assert.rejects(deliver({...f,manifestUrl:legacyManifestUrl},f.ports),/Stable publication/);
  assert.deepEqual(f.events,[]);
});

test('bad anonymous APK readback, private repository and changed pointer cannot advertise a candidate',async t => {
  for (const options of [{apkWrong:true},{isPrivate:true},{repoId:42},{pointerRace:true}]) {
    const f = fixture(t,options);
    await assert.rejects(deliver(f,f.ports));
    assert.equal(f.uploads.includes('alpha-update-stable.json'),false,JSON.stringify(options));
    if (options.isPrivate || options.repoId) assert.equal(f.uploads.length,0);
  }
});

test('stable publication cannot regress, mutate a version, or withdraw a different flavor/family',async t => {
  for (const previous of [{versionCode:9},{versionCode:8,notes:'different bytes'},{variant:'standalone'},{signerSha256:'b'.repeat(64)}]) {
    const f = fixture(t,{previous});
    await assert.rejects(deliver(f,f.ports));
    assert.equal(f.uploads.length,0,JSON.stringify(previous));
  }
});

test('manifest readback failure is a failed publication, never a successful receipt',async t => {
  const f = fixture(t,{manifestInvisible:true});
  await assert.rejects(deliver(f,f.ports),/manifest readback failed/);
  assert.equal(f.uploads.at(-1),'alpha-update-stable.json');
});

test('a missing manifest after interrupted replacement cannot reset the retained APK version floor',async t => {
  for (const assets of [[{name:'alpha-phone-100.apk'}],[{name:'alpha-update-stable.json'}]]) {
    const f = fixture(t);
    const original = f.ports.run;
    f.ports.run = (args,opts) => args[0] === 'release' && args[1] === 'view' && args[2] === stableTag
      ? JSON.stringify({isDraft:false,assets}) : original(args,opts);
    await assert.rejects(deliver(f,f.ports),/retained stable APK version floor|not publicly readable/);
    assert.equal(f.uploads.length,0);
  }
});

test('the publisher rechecks both release inventories after APK readback before moving the pointer',async t => {
  for (const tag of [legacyTag,stableTag]) {
    const f = fixture(t,{previous:{}});
    const run = f.ports.run;
    f.ports.run = (args,options) => {
      const release = run(args,options);
      if (args[0] !== 'release' || args[1] !== 'view' || args[2] !== tag || !f.events.includes('apk readback'))
        return release;
      const changed = release === null ? {isDraft:false,assets:[]} : JSON.parse(release);
      changed.assets.push({name:'alpha-phone-9.apk'});
      return JSON.stringify(changed);
    };
    await assert.rejects(deliver(f,f.ports),/version floor/);
    assert.deepEqual(f.uploads,['alpha-phone-8.apk']);
  }
});

test('final release inventory must still contain the verified APK and any listed pointer must be readable',async t => {
  for (const assets of [[],[{name:'alpha-phone-8.apk'},{name:'alpha-update-stable.json'}]]) {
    const f = fixture(t);
    const run = f.ports.run;
    f.ports.run = (args,options) => args[0] === 'release' && args[1] === 'view' && args[2] === stableTag && f.events.includes('apk readback')
      ? JSON.stringify({isDraft:false,assets}) : run(args,options);
    await assert.rejects(deliver(f,f.ports),/missing from the final stable release inventory|not publicly readable/);
    assert.deepEqual(f.uploads,['alpha-phone-8.apk']);
  }
});

test('an uploaded versioned APK is reused only after verifying its public bytes',async t => {
  const f = fixture(t);
  const original = f.ports.run;
  f.ports.run = (args,opts) => args[0] === 'release' && args[1] === 'view' && args[2] === stableTag
    ? JSON.stringify({isDraft:false,assets:[{name:'alpha-phone-8.apk'}]}) : original(args,opts);
  f.ports.read = async url => {
    if (url === legacyManifestUrl) return null;
    if (url === manifestUrl) return f.uploads.includes('alpha-update-stable.json') ? object(f.manifestBytes) : null;
    assert.equal(url,f.offer.apkUrl);
    f.events.push('apk readback');
    return object('synthetic qualified release bytes');
  };
  // The synthetic run port's invariant expects apkVisible after an upload; a
  // retry's existing APK instead proves this through the anonymous read port.
  f.ports.run = ((run) => (args,opts) => {
    if (args[1] === 'upload') {f.uploads.push(path.basename(args[3]));return '';}
    return run(args,opts);
  })(f.ports.run);
  await deliver(f,f.ports);
  assert.deepEqual(f.uploads,['alpha-update-stable.json']);
  assert.ok(f.events.includes('apk readback'));
});

test('public transport streams hashes, bounds body and rejects credential or plaintext redirects',async () => {
  const payload = Buffer.from('public artifact');
  const result = await publicObject('https://example.org/a',{maxBytes:payload.length,fetcher:async (_url,options) => {
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.authorization,undefined);
    return new Response(payload);
  }});
  assert.equal(result.sha256,sha(payload));
  assert.equal(result.size,payload.length);
  await assert.rejects(publicObject('https://example.org/a',{maxBytes:2,fetcher:async()=>new Response(payload)}),/exceeds/);
  for (const location of ['http://example.org/a','https://user:secret@example.org/a']) {
    let calls = 0;
    await assert.rejects(publicObject('https://example.org/a',{maxBytes:20,fetcher:async()=>{
      calls++; return new Response(null,{status:302,headers:{location}});
    }}),/credential-free HTTPS/);
    assert.equal(calls,1);
  }
  assert.equal(await publicObject('https://example.org/a',{maxBytes:20,missing:true,fetcher:async()=>new Response(null,{status:404})}),null);
});
