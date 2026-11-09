package ai.eliza.plugins.calendar;

import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import java.util.ArrayList;

/** Closed provider rows from the existing scoped Calendar guard fixture. */
public final class ScopedCalendarReviewProvider extends ContentResolver {
 private final ScopedCalendarSnapshotTest.Provider rows = new ScopedCalendarSnapshotTest.Provider();

 public static final long BEGIN = ScopedCalendarSnapshotTest.FIRST;
 public static final long END = BEGIN + 3600000;
 public static final String TITLE = "Series";
 public static final String BODY = "Private";
 public static final String LOCATION = "Desk";

 @Override public Cursor query(Uri uri,String[] fields,String where,String[] args,String sort) {
  return rows.query(uri,fields,where,args,sort);
 }

 @Override public void applyBatch(String authority,ArrayList<ContentProviderOperation> operations) {
  throw new AssertionError("Calendar review must not write provider rows");
 }

 public void changeEvent() { rows.events.get(0).put("title", "Changed elsewhere"); }
 public void changeSource() { rows.source.put("ownerAccount", "new-owner@invalid"); }
}
