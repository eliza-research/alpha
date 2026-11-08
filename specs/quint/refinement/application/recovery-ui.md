# Renderer failure UI refinement

The driver executes the product's global startup listeners, plain DOM recovery,
React `RootErrorBoundary`, diagnostics formatter and browser crash log. React and
JSDOM execute the rendered tree. A read-only appended export observes the three
module flags. The source and driver hashes are captured before compilation and
checked again after the trace campaign.

## Source correction

A startup failure could install a plain recovery panel while an already pending
React mount subsequently failed. The root boundary then rendered a second
panel with the same title ID. The reverse ordering also allowed a direct startup
recovery call to append another panel. Recovery now preserves the first panel in
either ordering. The React boundary still catches and records its failure when
plain startup recovery already owns the page.

## Checked projection

Fourteen source schedules check 68 checkpoints across all 14 model fields. They
cover listener installation, irrelevant resource errors, pre-install events,
startup rejection, healthy mounted event handling, both recovery orderings,
throwing dialog-close handlers, sticky React failure, unmount/remount, reload
requests, pending forced failure and hostile error-name access. The recovery
panel and persisted problem log are checked for synthetic private content.

Ten named scenarios and 1,000 simulations of up to 80 steps pass. Three Chromium
recovery tests pass, including a full reload after each ordering. The twelve
existing diagnostics tests also pass. A depth-six Apalache safety check passes on
the same model hash.

## Environment boundaries

The driver controls native plugin registration, the development flag, dialog
close and reload. It counts reload requests without navigating. Browser tests
separately execute reload and focus using the real renderer. Logging occurs
inside one throttle interval with four representative error classes. Two dialogs
and two reload requests bound the model.

JSDOM observations do not establish browser top-layer behavior, native
accessibility or installed WebView behavior. The native `RendererRecovery` model
owns Android renderer-process recovery. Arbitrary browser event schedules and
problem-log expiry remain separate obligations.
