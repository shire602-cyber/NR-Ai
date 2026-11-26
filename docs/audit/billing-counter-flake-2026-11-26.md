# Billing usage counter flake (2026-11-26)

In CI on commit 5505b5b5, the invoice create returned HTTP 200. The DB assertion expected
the stored invoice usage count to be 501 and read 500.
[GitHub Actions DB harness log](https://github.com/shire602-cyber/NR-Ai/actions/runs/45762635862/job/139715954200)

The usage gate starts the counter update from the response finish handler when enforcement
is off. The test slept for 50 ms and could query the row before the upsert committed.
The quota release after a rejected create used the same timing assumption.

The DB test now awaits the matching SQL operation on both paths before reading the counter.
The regression holds the increment open, verifies the count still reads 500, releases the
write, and verifies 501 after the query completes.
