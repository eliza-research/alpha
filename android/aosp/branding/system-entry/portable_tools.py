"""Discover already-installed tools. Never downloads a compiler or accepts SDK licenses."""
from pathlib import Path
import os, shutil, subprocess, sys

def java_binary(name):
    home = os.environ.get('JAVA_HOME')
    if home:
        candidate = Path(home) / 'bin' / name
        if not candidate.is_file(): raise RuntimeError('JAVA_HOME has no ' + name)
        return str(candidate)
    helper = Path('/usr/libexec/java_home')
    if sys.platform == 'darwin' and helper.is_file():
        result = subprocess.run([str(helper), '-v', '17+'], capture_output=True, text=True)
        if result.returncode == 0:
            candidate = Path(result.stdout.strip()) / 'bin' / name
            if candidate.is_file(): return str(candidate)
    candidate = shutil.which(name)
    if candidate: return candidate
    raise RuntimeError('Install a JDK or set JAVA_HOME; missing ' + name)

def android_api_jar(api):
    explicit = os.environ.get('ALPHA_ANDROID_API_JAR')
    if explicit: return Path(explicit).expanduser().resolve()
    home = os.environ.get('ANDROID_SDK_ROOT') or os.environ.get('ANDROID_HOME')
    if home: return Path(home).expanduser() / 'platforms' / f'android-{api}' / 'android.jar'
    defaults = [Path.home() / 'Library/Android/sdk', Path.home() / 'Android/Sdk']
    for root in defaults:
        jar = root / 'platforms' / f'android-{api}' / 'android.jar'
        if jar.is_file(): return jar
    raise RuntimeError(f'Android API {api} is required: set ANDROID_SDK_ROOT or ALPHA_ANDROID_API_JAR')
