#!/usr/bin/env python3
"""Compatibility CLI for the shared signed-Sense ZIP verifier."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[1] / 'vendor/eliza/packages/os/scripts/android/verify-sense-apk.py'), run_name='__main__')
