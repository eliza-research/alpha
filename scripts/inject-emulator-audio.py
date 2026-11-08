#!/usr/bin/env python3
"""Inject known PCM into an emulator's actual microphone; never replace app files.
Deps: isolated venv with grpcio + grpcio-tools. See docs/emulator-audio-injection.md.
Default is read-only inspection. --inject must be explicitly supplied to stream.
--check-microphone queries host input state only; run it before starting app capture.
--port selects the emulator (default 5554, emulator-5554); only the process started with that
explicit -port and its own discovery file are used. --repeat N --gap-seconds S streams the
given WAVs in turn N times with S seconds of silence after each (issue #395 latency harness).
"""
import argparse, hashlib, json, os, pathlib, shlex, subprocess, sys, tempfile, wave

HOME = pathlib.Path.home()
SDK = pathlib.Path(os.environ.get('ANDROID_HOME', HOME / 'Library/Android/sdk'))
PHRASE = 'Please remember to water the plants tomorrow morning.'

def phone_pid(port):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,args='], text=True).splitlines()
    matches = []
    for row in rows:
        bits = row.strip().split(None, 1)
        if len(bits) != 2 or 'qemu-system' not in bits[1]: continue
        args = shlex.split(bits[1])
        if '-port' in args and args[args.index('-port') + 1] == str(port): matches.append(int(bits[0]))
    if len(matches) != 1: raise ValueError(f'Exactly one emulator process with explicit -port {port} is required')
    return matches[0]

def discovery(pid, explicit, port):
    roots = [HOME / 'Library/Caches/TemporaryItems/avd/running', pathlib.Path(tempfile.gettempdir()) / 'avd/running', HOME / '.android/avd/running']
    candidates = [pathlib.Path(explicit)] if explicit else [r / f'pid_{pid}.ini' for r in roots]
    for p in candidates:
        if not p.is_file(): continue
        if p.name != f'pid_{pid}.ini' or p.stat().st_uid != os.getuid(): raise ValueError('Discovery file must belong to current user and matching emulator PID')
        data = dict(line.split('=', 1) for line in p.read_text().splitlines() if '=' in line and not line.startswith('#'))
        data = {k.strip(): v.strip() for k, v in data.items()}
        if data.get('port.serial') != str(port): raise ValueError(f'Discovery serial port does not match emulator-{port}')
        return data
    return {}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', help='Matching pid_<PID>.ini if outside standard discovery directories')
    parser.add_argument('--prepare', type=pathlib.Path, help='Create deterministic spoken-phrase WAV; does not contact emulator')
    parser.add_argument('--inject', type=pathlib.Path, nargs='+', help='Explicitly stream these PCM WAVs (in turn) into the emulator microphone')
    parser.add_argument('--check-microphone', action='store_true', help='Read authenticated microphone state only; exit 2 when host input is enabled')
    parser.add_argument('--port', type=int, default=5554, help='Console port of the owned emulator (emulator-<port>); default 5554')
    parser.add_argument('--phrase', default=PHRASE, help='Phrase for --prepare')
    parser.add_argument('--repeat', type=int, default=1, help='Stream the WAV list this many times (1-200)')
    parser.add_argument('--gap-seconds', type=float, default=0.5, help='Silence after each WAV (0.5-60)')
    args = parser.parse_args()
    if args.check_microphone and (args.inject or args.prepare):
        parser.error('--check-microphone cannot be combined with --inject or --prepare')
    if not 5554 <= args.port <= 5682 or args.port % 2: raise ValueError('Emulator console ports are even, 5554-5682')
    if not 1 <= args.repeat <= 200 or not 0.5 <= args.gap_seconds <= 60: raise ValueError('--repeat 1-200 and --gap-seconds 0.5-60')
    if args.prepare:
        args.prepare.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='alpha-speech-') as temp:
            aiff = pathlib.Path(temp) / 'speech.aiff'
            subprocess.run(['/usr/bin/say', '-v', 'Samantha', '-o', str(aiff), args.phrase], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['/opt/homebrew/bin/ffmpeg', '-v', 'error', '-y', '-i', str(aiff), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(args.prepare)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(json.dumps({'prepared': str(args.prepare), 'phrase': args.phrase, 'sha256': hashlib.sha256(args.prepare.read_bytes()).hexdigest()}))
        return
    pid = phone_pid(args.port); data = discovery(pid, args.metadata, args.port)
    mode = 'bearer' if data.get('grpc.token') else 'JWT' if any('jwks' in k or 'jwt' in k for k in data) else 'unknown'
    print(json.dumps({'serial': f'emulator-{args.port}', 'pid': pid, 'metadataPresent': bool(data), 'keys': sorted(data), 'authMode': mode}), flush=True)
    if not args.inject and not args.check_microphone: return
    if mode != 'bearer': raise ValueError('Authenticated bearer discovery required; JWT signing is not implemented; no insecure fallback')
    port = int(data.get('grpc.port', '0'))
    if not 1024 <= port <= 65535: raise ValueError('Invalid discovery gRPC port')
    clips = []
    if args.inject:
        for path in args.inject:
            with wave.open(str(path), 'rb') as wav:
                if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 16000, 'NONE'): raise ValueError('Expected mono 16kHz PCM signed16 WAV')
                if not 0 < wav.getnframes() <= 16000 * 30: raise ValueError('Speech fixture must be between zero and 30 seconds')
                clips.append(wav.readframes(wav.getnframes()))
    gap = bytes(int(16000 * args.gap_seconds) * 2)
    audio = b''.join(clip + gap for _ in range(args.repeat) for clip in clips)
    seconds = len(audio) / 32000
    import grpc
    from grpc_tools import protoc
    import grpc_tools
    with tempfile.TemporaryDirectory(prefix='alpha-emulator-proto-') as temp:
        proto = SDK / 'emulator/lib/emulator_controller.proto'
        include = pathlib.Path(grpc_tools.__file__).parent / '_proto'
        if protoc.main(['grpc_tools.protoc', '-I' + str(proto.parent), '-I' + str(include), '--python_out=' + temp, '--grpc_python_out=' + temp, str(proto)]) != 0: raise ValueError('Protocol compilation failed')
        sys.path.insert(0, temp)
        import emulator_controller_pb2 as pb
        import emulator_controller_pb2_grpc as rpc
        from google.protobuf.empty_pb2 import Empty
        metadata = [('authorization', 'Bearer ' + data['grpc.token'])]
        with grpc.insecure_channel('127.0.0.1:' + str(port)) as channel:
            stub = rpc.EmulatorControllerStub(channel)
            state = stub.getMicrophoneState(Empty(), metadata=metadata, timeout=5)
            if args.check_microphone:
                enabled = bool(state.realAudioEnabled)
                print(json.dumps({'checked': True, 'serial': f'emulator-{args.port}',
                                  'hostMicEnabled': enabled, 'safeForControlledInjection': not enabled,
                                  'audioInjected': False}), flush=True)
                return 2 if enabled else 0
            if state.realAudioEnabled: raise ValueError('Host microphone is enabled; disable it before isolated injection')
            def packets():
                # Default mode backpressures at the emulator; no timing-sensitive overwrite.
                padded = bytes(16000) + audio + (bytes(16000) if args.repeat == 1 else b'')
                for offset in range(0, len(padded), 640):
                    yield pb.AudioPacket(format=pb.AudioFormat(samplingRate=16000, channels=pb.AudioFormat.Mono, format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED), audio=padded[offset:offset+640])
            stub.injectAudio(packets(), metadata=metadata, timeout=seconds + 45)
    print(json.dumps({'injected': True, 'serial': f'emulator-{args.port}', 'pcmBytes': len(audio), 'clips': [hashlib.sha256(clip).hexdigest() for clip in clips], 'repeat': args.repeat, 'gapSeconds': args.gap_seconds, 'scope': 'Emulated microphone injection only; verify app transcript and saved note separately'}))

if __name__ == '__main__':
    try: sys.exit(main() or 0)
    except Exception as error:
        # gRPC exception details can include server diagnostics; never print auth material.
        status = error.code().name if callable(getattr(error, 'code', None)) else None
        print(json.dumps({'error': type(error).__name__, 'status': status, 'message': str(error) if isinstance(error, ValueError) else 'Audio helper failed; no credentials logged'}), file=sys.stderr)
        sys.exit(1)
