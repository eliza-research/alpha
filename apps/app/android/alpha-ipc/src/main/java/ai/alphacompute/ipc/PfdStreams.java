package ai.alphacompute.ipc;

import android.os.ParcelFileDescriptor;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Bounded inline-or-ParcelFileDescriptor payload transfer helpers avoiding Android's 1 MiB Binder transaction limit. */
public final class PfdStreams {
    private static final int COPY_BUFFER_BYTES = 16_384;
    private static final ExecutorService PIPE_WRITERS = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaIpcPipeWriter");
        thread.setDaemon(true);
        return thread;
    });

    /** Thrown when a Binder payload exceeds its configured maximum byte budget. */
    public static final class PayloadTooLargeException extends IOException {
        public PayloadTooLargeException(String message) {
            super(message);
        }
    }

    /** Framed payload carrying either an inline byte array (<= 64 KiB) or a readable {@link ParcelFileDescriptor}. */
    public record Payload(byte[] inlineBody, ParcelFileDescriptor bodyFd) implements Closeable {
        @Override public void close() {
            if (bodyFd != null) {
                try {
                    bodyFd.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private PfdStreams() {}

    /** Closes {@code fd} without throwing, safe on {@code null} or already-closed descriptors. */
    public static void closeQuietly(ParcelFileDescriptor fd) {
        if (fd == null) return;
        try {
            fd.close();
        } catch (IOException ignored) {
        }
    }

    /** Whether {@code data} exceeds {@link AlphaIpcContract#INLINE_BODY_LIMIT_BYTES} and must stream over a pipe FD. */
    public static boolean shouldUsePfd(byte[] data) {
        return data != null && data.length > AlphaIpcContract.INLINE_BODY_LIMIT_BYTES;
    }

    /** Packs {@code data} inline when within 64 KiB or streams it asynchronously through a {@link ParcelFileDescriptor} pipe. */
    public static Payload pack(byte[] data) throws IOException {
        return pack(data, AlphaIpcContract.MAX_PFD_BODY_BYTES);
    }

    /** Packs {@code data} with a custom upper byte bound. */
    public static Payload pack(byte[] data, int maxBytes) throws IOException {
        if (data == null) return new Payload(null, null);
        if (data.length > maxBytes) {
            throw new PayloadTooLargeException("Payload size " + data.length + " exceeds limit " + maxBytes);
        }
        if (!shouldUsePfd(data)) {
            return new Payload(data, null);
        }
        ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
        ParcelFileDescriptor readEnd = pipe[0];
        ParcelFileDescriptor writeEnd = pipe[1];
        PIPE_WRITERS.execute(() -> {
            try (ParcelFileDescriptor.AutoCloseOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(writeEnd)) {
                writeAll(out, data);
            } catch (IOException ignored) {
            }
        });
        return new Payload(null, readEnd);
    }

    /** Unpacks a Binder payload from either {@code inlineBody} or {@code bodyFd}, enforcing {@code maxBytes} and closing {@code bodyFd}. */
    public static byte[] unpack(byte[] inlineBody, ParcelFileDescriptor bodyFd, int maxBytes) throws IOException {
        try {
            if (bodyFd != null) {
                if (inlineBody != null && inlineBody.length > 0) {
                    throw new IOException("Payload must specify either inlineBody or bodyFd, not both");
                }
                try (ParcelFileDescriptor.AutoCloseInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(bodyFd)) {
                    return readBounded(in, maxBytes);
                }
            }
            if (inlineBody == null) return null;
            if (inlineBody.length > maxBytes) {
                throw new PayloadTooLargeException("Inline payload size " + inlineBody.length + " exceeds limit " + maxBytes);
            }
            return inlineBody;
        } finally {
            if (bodyFd != null) {
                try {
                    bodyFd.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    /** Reads all bytes from {@code input} up to {@code maxBytes}, failing closed with {@link PayloadTooLargeException} if exceeded. */
    public static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        if (maxBytes < 0) throw new IllegalArgumentException("maxBytes must be non-negative");
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(maxBytes, COPY_BUFFER_BYTES));
        byte[] buffer = new byte[COPY_BUFFER_BYTES];
        long total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > maxBytes) {
                throw new PayloadTooLargeException("Stream exceeded maximum allowed bytes: " + maxBytes);
            }
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /** Writes {@code data} in bounded slices to {@code output} and flushes. */
    public static void writeAll(OutputStream output, byte[] data) throws IOException {
        int offset = 0;
        while (offset < data.length) {
            int length = Math.min(COPY_BUFFER_BYTES, data.length - offset);
            output.write(data, offset, length);
            offset += length;
        }
        output.flush();
    }

    /** Splits {@code data} into chunks of at most {@code maxChunkBytes} for streaming Binder callbacks. */
    public static List<byte[]> chunkBytes(byte[] data, int maxChunkBytes) {
        if (maxChunkBytes <= 0) throw new IllegalArgumentException("maxChunkBytes must be positive");
        if (data == null || data.length == 0) return List.of();
        List<byte[]> chunks = new ArrayList<>((data.length + maxChunkBytes - 1) / maxChunkBytes);
        for (int offset = 0; offset < data.length; offset += maxChunkBytes) {
            int end = Math.min(data.length, offset + maxChunkBytes);
            chunks.add(Arrays.copyOfRange(data, offset, end));
        }
        return chunks;
    }
}
