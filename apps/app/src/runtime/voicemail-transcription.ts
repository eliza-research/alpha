/**
 * Voicemail transcripts on the Alpha image (Voicemail.qnt). A voicemail is transcribed on this phone
 * by the same on-device recognizer as dictation, one window at a time; its audio is never sent to a
 * cloud recognizer, whatever the dictation setting is. When the recognizer is not ready the Phone
 * view shows no transcript rather than using another route.
 */
import {createOnDeviceVoice} from './local-voice';
import {setVoicemailTranscriber} from '../prototype/phone-adapter';

export function installVoicemailTranscription() {
  setVoicemailTranscriber({
    mode: () => 'local',
    available: async signal => { const voice = createOnDeviceVoice(); return !!voice && await voice.ready(signal).catch(() => false); },
    transcribe: async (wav, _mode, signal) => {
      const voice = createOnDeviceVoice();
      if (!voice) throw new Error('On-device speech is unavailable');
      return (await voice.transcribeAudio(wav, signal)).text;
    },
  });
}
