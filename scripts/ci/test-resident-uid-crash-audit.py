import json,subprocess,sys,unittest
from unittest.mock import patch
from resident_uid_crash_audit import collect_crashes

def fixture(uid=1010123):
    lines=['*** *** *** *** *** *** *** ***','Cmdline: /data/app/~~fixture/ai.elizaresearch.alphaphone-random/lib/x86_64/libeliza_ld_musl_x86_64_real.so PRIVATE_SENTINEL',
           'pid: 1234, tid: 1235, name: worker  >>> PRIVATE_SENTINEL <<<',f'uid: {uid}',
           'signal 31 (SIGSYS), code 1 (SYS_SECCOMP), fault addr --------',
           'Cause: seccomp prevented call to disallowed x86_64 system call 21','Abort message: PRIVATE_SENTINEL']
    return '\n'.join('F/DEBUG   ( 999): '+line for line in lines)+'\n'

class CrashDiagnostics(unittest.TestCase):
    def test_real_process_capture_is_bounded_and_never_persists_raw_output(self):
        original=subprocess.Popen
        def child(command,**kwargs):
            self.assertIn(command,[['adb','-s','emulator-5554','logcat','-d','-b','crash','-v','brief','-t','500'],['adb','-s','emulator-5554','shell','dmesg | tail -n 500']])
            return original([sys.executable,'-c','import sys;sys.stdout.write('+repr(fixture())+');sys.stdout.write("PRIVATE_SENTINEL"*30000);sys.stdout.flush()'],**kwargs)
        with patch('resident_uid_crash_audit.subprocess.Popen',side_effect=child):result=collect_crashes('emulator-5554',1010123)
        self.assertTrue(result['truncated']);self.assertEqual(result['reports'][0]['syscall'],21)
        self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result))
        with self.assertRaises(ValueError):collect_crashes('physical-device',1010123)
    def test_hung_read_has_a_deadline(self):
        original=subprocess.Popen
        with patch('resident_uid_crash_audit.subprocess.Popen',side_effect=lambda command,**kwargs:original([sys.executable,'-c','import time;time.sleep(30)'],**kwargs)):
            result=collect_crashes('emulator-5554',1010123)
        self.assertTrue(result['timedOut']);self.assertEqual(result['reports'],[])

if __name__=='__main__':unittest.main()
