# Browser Cloud request custody baseline

This replay invokes the actual development bridge handler with closed request and response objects. An injected port holds the public entitlement-key response. The handler's profile filesystem functions are intercepted and the fixture asserts zero calls. No server is started and no request reaches Cloud.

Two handlers submit one request ID while the first is still pending. The duplicate returns HTTP 400 without dispatching a second provider request. An acknowledged Cancel then leaves the incumbent's actual signal unaborted. A third handler acquires the same ID while the incumbent remains held. After the incumbent returns HTTP 200, another acknowledged Cancel misses the third handler and it also returns HTTP 200.

The defect follows from assigning the duplicate's cleanup key before checking whether it owns the slot. Its finally block deletes the incumbent. That allows another generation to enter, and the incumbent's delayed finally can then delete the successor. Each replay checkpoint observes actual dispatch, abort signal, response listener custody and status.

Run the exact baseline from its commit with Node 26.

```sh
node --test --test-concurrency=1 test/quint-browser-cloud-request-custody.test.mjs
```
