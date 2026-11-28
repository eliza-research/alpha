// spec/app/calendar/sharing.md, "The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed"

lemma TickedAfter(s: Availability, calendar: string)
  ensures tick(s, calendar).ticked == (if (calendar in s.ticked) then ProofLib.Filter((set_x: string) => !((set_x in [calendar])), s.ticked) else (s.ticked + ProofLib.Filter((set_x: string) => !((set_x in s.ticked)), [calendar])))
{
}

lemma tick_ensures(s: Availability, calendar: string)
  ensures (inv(s) ==> canTick(s, calendar) ==> alwaysOnlyTickedOfferedCalendarsAreRead(tick(s, calendar)))
  ensures (inv(s) ==> canTick(s, calendar) ==> alwaysOnlyAFreeOrBusyAnswerIsShown(tick(s, calendar)))
{
  if inv(s) && canTick(s, calendar) {
    var after := tick(s, calendar);
    TickedAfter(s, calendar);
    forall x | x in after.ticked ensures x in s.offered {
      if calendar in s.ticked {
        ProofLib.FilterMember((set_x: string) => !((set_x in [calendar])), s.ticked, x);
      } else {
        ProofLib.FilterMember((set_x: string) => !((set_x in s.ticked)), [calendar], x);
      }
    }
  }
}
