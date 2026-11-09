package ai.alphacompute.alphaphone;
import org.junit.Test;
import ai.eliza.plugins.reminders.ReminderDeletionJournalFixture;
/** Product runner entry for the package-private shared-store fixture. */
public final class ReminderDeletionJournalInstrumentedTest {
 @Test public void persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence()throws Exception{new ReminderDeletionJournalFixture().persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence();}
 @Test public void undoOfPostedReminderPostsItAgain()throws Exception{new ReminderDeletionJournalFixture().undoOfPostedReminderPostsItAgain();}
 @Test public void undoFromPausedDeletionReArmsTheAlert()throws Exception{new ReminderDeletionJournalFixture().undoFromPausedDeletionReArmsTheAlert();}
 @Test public void expiryIsSingleWinnerAndChangedBootRequiresReview()throws Exception{new ReminderDeletionJournalFixture().expiryIsSingleWinnerAndChangedBootRequiresReview();}
}
