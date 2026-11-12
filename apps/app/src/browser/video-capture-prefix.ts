import type { Input } from 'mediabunny';

/** A byte limit can leave a prefix of a recording. Read the admitted media timeline
 * before handing it to the library, which uses this duration for trim and playback. */
export async function measureVideoPrefix(blob: Blob, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const invalid = () => Error('The video at the size limit could not be read. Try a shorter recording.');
  const video = document.createElement('video');
  video.preload = 'auto';
  const url = URL.createObjectURL(blob);
  let input: Input | undefined;
  let retired = false;
  let rejectRead!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject; });
  const abort = () => rejectRead(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => rejectRead(invalid()), 5000);
  async function read() {
    // A recorder can emit a valid, very short MP4 that the browser can
    // decode even when the container reader cannot enumerate its packets.
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(invalid());
      video.src = url;
    });
    if (retired) throw invalid();
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    // Streaming WebM can report Infinity even after the recorder stops.
    // Use the timestamps of the stored packets for those files.
    const { BlobSource, EncodedPacketSink, Input, MP4, WEBM } = await import('mediabunny');
    if (retired) throw invalid();
    input = new Input({ source: new BlobSource(blob), formats: [blob.type === 'video/mp4' ? MP4 : WEBM] });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw invalid();
    const packets = new EncodedPacketSink(track);
    const [key, last, end] = await Promise.all([
      packets.getFirstKeyPacket(),
      packets.getPacket(Infinity),
      input.computeDuration(),
    ]);
    if (!key?.data.byteLength || !last?.data.byteLength || !Number.isFinite(end) || end <= 0) throw invalid();
    return end;
  }
  try {
    return await Promise.race([read(), interrupted]);
  } catch {
    signal.throwIfAborted();
    throw invalid();
  } finally {
    retired = true;
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
    input?.dispose();
    video.onloadeddata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
