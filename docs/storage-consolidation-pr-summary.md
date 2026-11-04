## Summary

- Provision separate general-data and combined AIMIE storage accounts in North
  Central US for Test and Production, with Blob, Queue, and Table private endpoints.
- Disable shared-key and anonymous Blob access; grant the AKS workload identities
  the required data roles. General-data accounts retain a default-deny firewall
  with the trusted Azure service access required by Video Indexer.
- Consolidate portal, current Data Automation, and integrity-cache data into
  `probonolawdata`; combine AIMIE Service history and AIMIE Config in `aimiedata`.
- Add allowlisted Blob/Table/Queue migration, verification, cutover, and cleanup
  tools. Exclude legacy Functions-centric Data Automation data.
- Remove the unused notification and Markdown storage definitions and add the
  requested Test Cosmos DB item-read permission.

## Deployment and verification

- Test and Production runtime cutovers are complete. Portal, AIMIE, Account
  Operations, AIMIE Operations, Email Operations, and File Operations use their
  corresponding new accounts.
- Verified current Data Automation Blob baselines: Test 237,045; Production
  27,816. Integrity-cache baselines: Test 55,432; Production 4,826.
- Copied and verified 12,519 ingestion-table entities, 9,600 poison-queue messages,
  2,258 AIMIE historical large-message blobs, and 14,558 AIMIE historical table
  entities across the two environments. Portal migration covered 24 blobs and
  1,676 table entities. Newer AIMIE agent configuration was preserved.
- Live workload-identity Blob/Queue/Table checks and post-cutover checkpoint writes
  passed. Workloads and scheduled jobs were restored; all temporary migration
  access was removed.
- Pulumi graph checks passed for 519 Test and 626 Production resources. Migration
  tests passed; the application PR's final tests and image builds passed.

## Related application change and retained resources

[File Operations PR 89](https://github.com/probonolaw/Probono-Law-File-Operations/pull/89)
adds service-URL clients using workload identity and streams Content Understanding
input from private storage. Its validated images are deployed in both environments;
merge that PR before a subsequent main-branch deployment.

Retain source accounts for existing Video Indexer assets, historical Blob URLs,
operational history, and retention requirements. Azure rejects changing an
existing Video Indexer's connected storage account. These sources are not yet
eligible for deletion solely because their data was copied.

The user selected [replacement Video Indexer accounts and reindexing](video-indexer-replacement-plan.md)
as the next phase. The plan covers 24 Test and 12 Production videos, with Test
validation before Production cutover; replacement accounts are not yet deployed.

See [the execution record](storage-migration-execution-2026-10-26.md) for account
names, live network exceptions, image digests, migration details, and verification.
