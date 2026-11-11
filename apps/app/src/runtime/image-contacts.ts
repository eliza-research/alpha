type ContactsShell = {S(): {view?: unknown}; goHome(): void};

/** Applies the image's current Contacts admission to the view order and the open shell. A shell
 * showing Contacts leaves it while the view is still admitted: once deferred, the shell reports no
 * view, so the view's leave hook and the return to Home would not run. */
export function applyImageContacts(admitted: boolean, order: string[], shell: ContactsShell | null | undefined, admit: (admitted: boolean) => void): void {
  if (!admitted && shell?.S().view === 'contacts') shell.goHome();
  admit(admitted);
  const index = order.indexOf('contacts');
  if (admitted && index < 0) order.push('contacts');
  else if (!admitted && index >= 0) order.splice(index, 1);
}
