"""Run the actual product Gradle input block with installed Groovy/JDK; no APK or network."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'android/app/product.gradle').read_text()
block = source[source.index('// One-tap app update'):source.index("\nandroid {")]
java = str(Path(os.environ['JAVA_HOME']) / 'bin/java')
classpath = str(Path(os.environ['GRADLE_LIB']) / '*')
public = 'https://example.test/public-update.json'
url = ('https://storage.googleapis.com/alpha-aosp-lab-20261024-private-apks/update-qa/'
       + 'a' * 32 + '/alpha-update.json?X-Goog-Algorithm=GOOG4-RSA-SHA256'
       + '&X-Goog-Expires=21600&X-Goog-Signature=synthetic')
sha = lambda value: hashlib.sha256(value.encode()).hexdigest()
results = []
with tempfile.TemporaryDirectory(prefix='alpha-channel-gradle-') as temporary:
    directory = Path(temporary)
    project = directory / 'source/android/app'
    project.mkdir(parents=True)
    (directory / 'source/app.config.json').write_text(json.dumps({'updateManifestUrl': public}))
    script = directory / 'check.groovy'
    script.write_text("import org.gradle.api.GradleException\n"
                     "def unpackagedRuntime=System.getenv('QA_TEST_UNPACKAGED')=='1'\n"
                     "def testMocksRaw=System.getenv('QA_TEST_MOCKS') ?: '0'\n"
                     "def file={String name -> new File(System.getenv('QA_TEST_PROJECT'), name)}\n"
                     + block + "\nprintln(groovy.json.JsonOutput.toJson([kind:updateChannel,manifestUrlSha256:updateManifestSha256]))\n")
    input_file = directory / 'private-input'
    base = {key: value for key, value in os.environ.items()
            if key not in ('ALPHA_UPDATE_CHANNEL', 'ALPHA_PRIVATE_UPDATE_MANIFEST_FILE',
                           'ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256', 'QA_TEST_UNPACKAGED', 'QA_TEST_MOCKS')}
    base['QA_TEST_PROJECT'] = str(project)
    cases = [
        ('public', {}, public, True),
        ('private', {}, url, True),
        ('private-gcloud-lowercase', {}, url.replace('X-Goog-', 'x-goog-'), True),
        ('wrong-digest', {'ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256': 'f' * 64}, url, False),
        ('undeclared', {'ALPHA_UPDATE_CHANNEL': 'public'}, url, False),
        ('wrong-prefix', {}, url.replace('update-qa/', 'public/'), False),
        ('readable-file', {}, url, False),
        ('duplicate-query', {}, url + '&X-Goog-Expires=300', False),
        ('duplicate-query-case-alias', {}, url + '&x-goog-expires=300', False),
        # The private channel no longer depends on a runtime profile: it needs a complete packaged
        # build with test mocks off.
        ('unpackaged-runtime', {'QA_TEST_UNPACKAGED': '1'}, url, False),
        ('test-mocks', {'QA_TEST_MOCKS': '1'}, url, False),
        ('symlink', {}, url, False),
        ('source-contained', {}, url, False),
        ('newline', {}, url + '\n', False),
    ]
    for name, override, value, accepted in cases:
        input_file.write_text(value)
        input_file.chmod(0o644 if name == 'readable-file' else 0o600)
        env = dict(base)
        if name != 'public':
            env.update(ALPHA_UPDATE_CHANNEL='private-qa',
                       ALPHA_PRIVATE_UPDATE_MANIFEST_FILE=str(input_file),
                       ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256=sha(value))
        if name == 'symlink':
            linked = directory / 'linked'
            linked.symlink_to(input_file)
            env['ALPHA_PRIVATE_UPDATE_MANIFEST_FILE'] = str(linked)
        if name == 'source-contained':
            contained = directory / 'source/private-input'
            contained.write_text(value)
            contained.chmod(0o600)
            env['ALPHA_PRIVATE_UPDATE_MANIFEST_FILE'] = str(contained)
        env.update(override)
        run = subprocess.run([java, '-cp', classpath, 'groovy.ui.GroovyMain', str(script)],
                             env=env, capture_output=True, text=True, timeout=40)
        output = run.stdout + run.stderr
        assert value.strip() not in output, 'Input capability leaked into diagnostics'
        if accepted:
            assert run.returncode == 0, f'{name}: configuration execution failed: {output}'
            assert json.loads(run.stdout) == {'kind': 'public' if name == 'public' else 'private-qa',
                                             'manifestUrlSha256': sha(value)}
        else:
            assert run.returncode != 0 and 'Update channel input refused' in output, name
        results.append({'case': name, 'passed': True})
print(json.dumps({'scope': 'actual Gradle input block only; no APK or endpoint', 'results': results}, indent=2))
