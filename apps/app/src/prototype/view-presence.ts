/**
 * View enter/leave events from the shell itself. The listener runs once after a shell commit
 * (a view opening or closing, the chat covering a view, any state the view renders from) and
 * when the page is hidden or shown. It replaces observing every DOM mutation in the document:
 * views read their own state from the shell, and the DOM they need is committed by then.
 */
type ShellPrototype = { componentDidMount?: (...args: unknown[]) => unknown; componentDidUpdate?: (...args: unknown[]) => unknown };

export function installViewPresence(Component: unknown, changed: () => void): () => void {
  const prototype = (Component as { prototype?: ShellPrototype } | undefined)?.prototype;
  let installed = true;
  const notify = () => { if (installed) changed(); };
  const didMount = prototype?.componentDidMount, didUpdate = prototype?.componentDidUpdate;
  const mounted = function (this: unknown, ...args: unknown[]) { const result = didMount?.apply(this, args); notify(); return result; };
  const updated = function (this: unknown, ...args: unknown[]) { const result = didUpdate?.apply(this, args); notify(); return result; };
  if (prototype) { prototype.componentDidMount = mounted; prototype.componentDidUpdate = updated; }
  document.addEventListener('visibilitychange', notify);
  return () => {
    installed = false;
    document.removeEventListener('visibilitychange', notify);
    // Another adapter may have wrapped these since; then ours stays as a pass-through.
    if (prototype?.componentDidMount === mounted) prototype.componentDidMount = didMount;
    if (prototype?.componentDidUpdate === updated) prototype.componentDidUpdate = didUpdate;
  };
}
