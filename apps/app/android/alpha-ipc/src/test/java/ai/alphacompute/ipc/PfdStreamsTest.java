package ai.alphacompute.ipc;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import org.junit.Test;

/** Unit tests for bounded payload framing and chunking in {@link PfdStreams}. */
public final class PfdStreamsTest {
    @Test public void inlineThresholdSwitchesAt64KiB() {
        assertFalse(PfdStreams.shouldUsePfd(null));
        assertFalse(PfdStreams.shouldUsePfd(new byte[AlphaIpcContract.INLINE_BODY_LIMIT_BYTES]));
        assertTrue(PfdStreams.shouldUsePfd(new byte[AlphaIpcContract.INLINE_BODY_LIMIT_BYTES + 1]));
    }

    @Test public void readBoundedEnforcesMaximumSize() throws IOException {
        byte[] payload = new byte[100_000];
        for (int index = 0; index < payload.length; index++) payload[index] = (byte) (index & 0xff);
        byte[] read = PfdStreams.readBounded(new ByteArrayInputStream(payload), 100_000);
        assertArrayEquals(payload, read);
        try {
            PfdStreams.readBounded(new ByteArrayInputStream(payload), 99_999);
            fail("Expected PayloadTooLargeException");
        } catch (PfdStreams.PayloadTooLargeException expected) {
            assertTrue(expected.getMessage().contains("99999"));
        }
    }

    @Test public void writeAllAndChunkBytesRoundTripExactPayload() throws IOException {
        byte[] source = new byte[1_100_000];
        for (int index = 0; index < source.length; index++) source[index] = (byte) ((index * 31) & 0xff);
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        PfdStreams.writeAll(sink, source);
        assertArrayEquals(source, sink.toByteArray());

        List<byte[]> chunks = PfdStreams.chunkBytes(source, AlphaIpcContract.MAX_STREAM_CHUNK_BYTES);
        assertEquals(34, chunks.size());
        ByteArrayOutputStream reassembled = new ByteArrayOutputStream();
        for (byte[] chunk : chunks) {
            assertTrue(chunk.length <= AlphaIpcContract.MAX_STREAM_CHUNK_BYTES);
            reassembled.write(chunk);
        }
        assertArrayEquals(source, reassembled.toByteArray());
    }

    @Test public void closeQuietlyAndNullPayloadCloseAreSafe() {
        PfdStreams.closeQuietly(null);
        PfdStreams.Payload payload = new PfdStreams.Payload(new byte[] { 1, 2, 3 }, null);
        payload.close();
        assertEquals(3, payload.inlineBody().length);
    }
}
