# Browser Cloud request custody baseline

This replay invokes the actual development bridge handler with closed request and response objects. An injected port holds the public entitlement-key response. The handler's profile filesystem functions are intercepted and the fixture asserts zero calls. No server is started and no request reaches Cloud.

Two handlers submit one request ID while the first is still pending. The duplicate returns HTTP 400 without dispatching a second provider request. An acknowledged Cancel then leaves the incumbent's actual signal unaborted. A third handler acquires the same ID while the incumbent remains held. After the incumbent returns HTTP 200, another acknowledged Cancel misses the third handler and it also returns HTTP 200.

The defect follows from assigning the duplicate's cleanup key before checking whether it owns the slot. Its finally block deletes the incumbent. That allows another generation to enter, and the incumbent's delayed finally can then delete the successor. Each replay checkpoint observes actual dispatch, abort signal, response listener custody and status.

Run the exact baseline from commit `e180629fe55222711484fefd9a1e4eb6f6ddf807` with Node 26.

```sh
bun test test/quint-browser-cloud-request-custody.test.mjs
```

## Corrected request custody

[BrowserCloudRequestCustody](../../services/BrowserCloudRequestCustody.qnt) keeps each ID owned by the exact admitted handler until its settlement. A duplicate does not record an owned ID, and cleanup only removes the row that carries the same abort controller. Acknowledged cancellation reaches the incumbent and the slot remains occupied while its upstream result is still pending. Once the handler settles, a new request can reuse the ID.

Three source traces check 25 states including the initial observations. They compare real provider-port dispatch, close-listener custody, abort signals and response codes for duplicate, targeted cancel, response close, late upstream completion and reuse. The source handler's map is private. Duplicate admission and targeted cancellation provide indirect evidence of ownership. Real HTTP connections, authenticated route-specific effects, account and login changes, process restarts and provider effects remain separate.

Run the corrected replay with the same focused Node command above.
