#!/usr/bin/env python3
"""Build debug-only ordinary UID fixture and anchor source/APK/signer in archive."""
import hashlib,json,os,re,shutil,subprocess
from pathlib import Path
repository=Path.cwd().resolve();archive=Path('test-results/resident-ci-archive');project=Path('android/private-peer-fixture')
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def sources():
 paths=[project/'build.gradle',project/'settings.gradle',Path(__file__)]+list((project/'src').rglob('*'))
 return {str(p.resolve().relative_to(repository)):h(p) for p in sorted(paths) if p.is_file()}
before=sources()
# The generated Android host supplies the hash-pinned Gradle wrapper (scripts/android-host.mjs).
subprocess.run(['node','scripts/android-host.mjs'],check=True,timeout=300)
subprocess.run(['android/gradlew','-p',str(project),'--no-daemon','assembleDebug'],check=True,timeout=600)
assert sources()==before,'Helper sources changed during build'
target=archive/'private-peer-debug.apk';assert not target.exists()
shutil.copyfile(project/'build/outputs/apk/debug/alpha-resident-peer-fixture-debug.apk',target)
sdk=Path(os.environ['ANDROID_HOME']);signer=sdk/'build-tools/36.0.0/apksigner'
def certificate(apk):
 text=subprocess.check_output([str(signer),'verify','--print-certs',str(apk)],text=True)
 certs=re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$',text,re.M)
 assert len(certs)==1;return certs[0]
badging=subprocess.check_output([str(sdk/'build-tools/36.0.0/aapt'),'dump','badging',str(target)],text=True)
assert re.search(r"^package: name='ai.elizaresearch.alphaphone.peerfixture' ",badging,re.M)
assert 'application-debuggable' in badging and 'launchable-activity:' not in badging
assert 'android.permission.INTERNET' not in badging
cert=certificate(target)
for variant in ['standalone','launcher']:
 for kind in ['debug','androidTest']:assert certificate(archive/(variant+'-'+kind+'.apk'))==cert
meta={'schemaVersion':1,'package':'ai.elizaresearch.alphaphone.peerfixture','apkSha256':h(target),'signerSha256':cert,'sources':before}
metadata=archive/'private-peer-manifest.json';assert not metadata.exists();metadata.write_text(json.dumps(meta,indent=2)+'\n')
p=archive/'apk-manifest.json';manifest=json.loads(p.read_text());assert len(manifest)==6
manifest.update({target.name:h(target),metadata.name:h(metadata)});p.write_text(json.dumps(manifest,indent=2)+'\n')
