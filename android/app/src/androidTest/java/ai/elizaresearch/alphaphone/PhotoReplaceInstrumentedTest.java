package ai.elizaresearch.alphaphone;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import ai.eliza.plugins.media.OwnedPhotoEdits;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Random;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class PhotoReplaceInstrumentedTest {
  private Context context;
  private ContentResolver resolver;
  private Uri photo;
  private String token;

  @Before public void createPhoto() throws Exception {
    assumeTrue(Build.VERSION.SDK_INT >= 30);
    context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    resolver = context.getContentResolver();
    ContentValues values = new ContentValues();
    values.put("_display_name", "alpha-replace-" + UUID.randomUUID() + ".png");
    values.put("mime_type", "image/png");
    values.put("relative_path", "Pictures/AlphaPhone-tests/");
    values.put("is_pending", 1);
    photo = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
    assertNotNull(photo);
    writePhoto(7);
    ContentValues published = new ContentValues();
    published.put("is_pending", 0);
    assertEquals(1, resolver.update(photo, published, null, null));
  }

  @After public void deletePhoto() {
    if (photo != null)
      resolver.delete(photo, null, null);
    if (token != null) {
      backup().delete();
      context.getSharedPreferences("alpha-photo-edit-results", 0).edit().remove(token).commit();
    }
  }

  @Test public void failedWriteRestoresOriginal() throws Exception {
    byte[] original = readPhoto();
    Faulty writer = new Faulty(1000, 1);
    failWrite(writer);
    assertEquals(2, writer.opens);
    assertArrayEquals(original, readPhoto());
    assertEquals("failed", result());
    assertFalse(backup().exists());
  }

  @Test public void laterResultRestoresTheSameRecordedDamage() throws Exception {
    byte[] original = readPhoto();
    failWrite(new Faulty(1000, Integer.MAX_VALUE));
    assertEquals(1000, readPhoto().length);
    assertTrue(backup().exists());
    assertEquals("unknown", edits(new Faulty(500, 1)).result(token).getString("status"));
    assertEquals(500, readPhoto().length);
    assertEquals("failed", result());
    assertArrayEquals(original, readPhoto());
    assertFalse(backup().exists());
    assertEquals("failed", result());
  }

  @Test public void laterResultLeavesNewerPhotoAndOriginalBackupIntact() throws Exception {
    byte[] original = readPhoto();
    failWrite(new Faulty(1000, Integer.MAX_VALUE));
    writePhoto(21);
    byte[] newer = readPhoto();
    Faulty observer = new Faulty(1000, 0);
    assertEquals("unknown", edits(observer).result(token).getString("status"));
    assertEquals(0, observer.opens);
    assertArrayEquals(newer, readPhoto());
    assertTrue(backup().exists());
    assertArrayEquals(original, java.nio.file.Files.readAllBytes(backup().toPath()));
  }

  @Test public void interruptedWriteWithoutDamageProofRetainsBackup() throws Exception {
    failWrite(new Faulty(1000, Integer.MAX_VALUE));
    android.content.SharedPreferences journal =
        context.getSharedPreferences("alpha-photo-edit-results", 0);
    JSONObject interrupted = new JSONObject(journal.getString(token, ""));
    interrupted.remove("damage");
    assertTrue(journal.edit().putString(token, interrupted.toString()).commit());
    byte[] interruptedBytes = readPhoto();
    Faulty observer = new Faulty(1000, 0);
    assertEquals("unknown", edits(observer).result(token).getString("status"));
    assertEquals(0, observer.opens);
    assertArrayEquals(interruptedBytes, readPhoto());
    assertTrue(backup().exists());
  }

  @Test public void completedWriteWithCloseErrorIsSaved() throws Exception {
    OwnedPhotoEdits edit = edits(new Faulty(-1, 1));
    begin(edit);
    JSONObject receipt = edit.replace(token, 90, false, "none");
    assertEquals("saved", receipt.getString("status"));
    assertTrue(receipt.getBoolean("replaced"));
    byte[] bytes = readPhoto();
    Bitmap rotated = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    assertNotNull(rotated);
    try {
      assertEquals(192, rotated.getWidth());
      assertEquals(256, rotated.getHeight());
    } finally {
      rotated.recycle();
    }
    assertFalse(backup().exists());
  }

  private void failWrite(Faulty writer) throws Exception {
    OwnedPhotoEdits edit = edits(writer);
    begin(edit);
    try {
      edit.replace(token, 90, false, "none");
      fail("Expected the injected write failure");
    } catch (IOException expected) {
      assertEquals("No space left on device", expected.getMessage());
    }
  }

  private void begin(OwnedPhotoEdits edit) throws Exception {
    String revision;
    try (Cursor row = resolver.query(photo,
        new String[] {"date_added", "_size", "generation_modified", "is_trashed"},
        null, null, null)) {
      assertNotNull(row);
      assertTrue(row.moveToFirst());
      revision = row.getLong(0) + ":" + row.getLong(1) + ":" + row.getLong(2) + ":" + row.getInt(3);
    }
    JSONObject session = edit.begin(Long.toString(ContentUris.parseId(photo)), revision);
    assertTrue(session.getBoolean("canReplace"));
    token = session.getString("sessionId");
  }

  private OwnedPhotoEdits edits(OwnedPhotoEdits.ReplaceOutput output) {
    return new OwnedPhotoEdits(context, AlphaMediaConfig.MEDIA, null, output);
  }

  private String result() throws Exception {
    return edits(null).result(token).getString("status");
  }

  private File backup() {
    return new File(new File(context.getFilesDir(), "photo-replace-backups"), token + ".original");
  }

  private byte[] readPhoto() throws Exception {
    try (InputStream in = resolver.openInputStream(photo);
         ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      assertNotNull(in);
      byte[] buffer = new byte[16384];
      int count;
      while ((count = in.read(buffer)) != -1)
        out.write(buffer, 0, count);
      return out.toByteArray();
    }
  }

  private void writePhoto(int seed) throws Exception {
    Bitmap bitmap = Bitmap.createBitmap(256, 192, Bitmap.Config.ARGB_8888);
    Random random = new Random(seed);
    int[] pixels = new int[256 * 192];
    for (int i = 0; i < pixels.length; i++)
      pixels[i] = 0xff000000 | random.nextInt(0x1000000);
    bitmap.setPixels(pixels, 0, 256, 0, 0, 256, 192);
    try (OutputStream out = resolver.openOutputStream(photo, "wt")) {
      assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out));
    } finally {
      bitmap.recycle();
    }
  }

  private static final class Faulty implements OwnedPhotoEdits.ReplaceOutput {
    private final int limit;
    private final int failures;
    private int opens;

    Faulty(int limit, int failures) {
      this.limit = limit;
      this.failures = failures;
    }

    @Override public OutputStream open(ContentResolver resolver, Uri target) throws IOException {
      OutputStream output = resolver.openOutputStream(target, "wt");
      if (opens++ >= failures)
        return output;
      return new FilterOutputStream(output) {
        private int written;

        @Override public void write(int value) throws IOException {
          if (limit >= 0 && written >= limit)
            throw new IOException("No space left on device");
          out.write(value);
          written++;
        }

        @Override public void write(byte[] values, int offset, int length) throws IOException {
          for (int i = 0; i < length; i++)
            write(values[offset + i]);
        }

        @Override public void close() throws IOException {
          super.close();
          if (limit < 0)
            throw new IOException("close failed");
        }
      };
    }
  }
}
