# Storage migration execution — 26 October 2026

The subsequent retirement is documented in the
[27 October execution record](storage-retirement-execution-2026-10-27.md).
The account-retention statements below describe the state on 26 October.

This records live changes after the initial provisioning and migration plans.
Source accounts are retained until their remaining consumers, stored URLs, and
retention requirements are resolved. Legacy Functions-centric Data Automation
containers, tables, and file shares are excluded from every copy allowlist.

## Runtime authorization

| Environment | General data | AIMIE |
| --- | --- | --- |
| Test | `probonolawdatatestsuffix` | `aimiedatatestsuffix` |
| Production | `probonolawdataprodsuffix` | `aimiedataprodsuffix` |

- All four accounts disable shared-key authorization and anonymous Blob access.
- Both general-data accounts have a default-deny firewall and the trusted Azure
  services exception. Video Indexer uses its managed identity through that
  exception. AKS resolves Blob, Queue, and Table through private endpoints.
- The AIMIE definitions disable public network access. Production matches that
  state. A later live read found Test AIMIE with public networking enabled under
  a default-deny firewall and the operator IP `203.0.113.150` allowed; this run did
  not add that exception. Shared keys and anonymous Blob access remain disabled.
- File Operations runtime identities have account-scoped Storage Blob Data
  Contributor, Storage Queue Data Contributor, and Storage Table Data Contributor
  on their environment's general-data account.
- AIMIE runtime identities have Blob Data Owner, Queue Data Contributor, and Table
  Data Contributor. Blob Data Owner includes the requested Blob contributor data
  permissions. Existing explicit `agents` owner assignments are retained.
- Account, AIMIE Operations, Email Operations, and portal grants remain scoped to
  their required containers/tables. The general-data module now deploys the Test
  grants as well as Production grants.
- Live workload-identity probes passed Blob, Queue, and Table create/write/read/
  delete in both environments. Probe data was deleted.

## Completed migrations and cutovers

| Workload/data | Test | Production |
| --- | --- | --- |
| Portal | Previously verified 10 blobs / 840 table entities; runtime uses new account | Copied and verified 14 blobs / 836 table entities; runtime switched and both replicas restored |
| AIMIE runtime | Already used new account when this execution began | Already used new account when this execution began |
| AIMIE historical large-message blobs | Copied and verified 1,330 | Copied and verified 928 |
| AIMIE historical table entities | Merged and verified 4,948 | Merged and verified 9,610 |
| Account, AIMIE, and Email Operations | Seven containers synchronized under a writer pause; 12 deployments and scheduled email job restored | Same procedure completed; 12 deployments and scheduled email job restored |
| File Operations | Final Blob/Table/Queue sync verified; all 12 deployments (27 pods) and scheduled sync restored at 19:07 UTC | Same procedure completed at 19:16 UTC; all 12 deployments (27 pods) and scheduled sync restored |

Portal health, staff, and jurisdiction endpoints returned HTTP 200 after the
Production rollout. Operations mounted settings point to the new account in
both environments, and new checkpoint writes were verified after cutover.

AIMIE historical merges preserve newer destination entities and do not import
old host leases, partition ownership, host keys, or diagnostic tables into the
active runtime. Historical large-message URLs in table values were changed to
the verified destination blobs. The old source instances were terminal and their
queues empty. The active destination's 24 agent files were preserved: Production
contains newer files that differ from the old configuration account.

## File Operations migration and verification

- Production's Data Automation Blob baseline: 27,816 verified blobs.
- Test's Data Automation Blob baseline: 237,045 verified blobs. The two changed
  AIMIE Operations checkpoints reported during the baseline were handled by the
  separate Operations final sync and cutover; they are excluded from the File
  Operations final sync.
- Integrity-cache Blob baselines are copied and verified: Test 55,432 blobs in
  57 containers; Production 4,826 blobs in 30 containers. No source changes or
  removals were detected during baseline verification.
- `IngestionProgress` was copied and verified under the writer pause: Test 3,128
  table entities and Production 9,391. All six evidence queues were copied and
  verified: poison queues Test 8,954 and Production 646; the other five queues
  were empty. Source messages were retained and visibility was restored.
- File Operations now uses the new general-data account through service URLs in
  `BLOB_CONNECTION_STRING`, `CHECKPOINT_STORAGE_CONNECTION_STRING`, and
  `TABLE_CONNECTION_STRING`, with `INPUT_ACCOUNT_NAME` set to the new account.
  [Draft application PR 89](https://github.com/probonolaw/Probono-Law-File-Operations/pull/89)
  adds workload-identity Blob/Queue/Table clients and streams Content Understanding
  inputs from private storage. Commit `4afcd9d0d15e4a3e4fae2730f0e2da6aedfaecdd`
  passed tests and both image builds in
  [CI run 40377377435](https://github.com/probonolaw/Probono-Law-File-Operations/actions/runs/40377377435).
- Images were published through the existing Test CI environment and Azure OIDC
  publishing identity, without adding Azure permissions or restarting local
  Docker. [Run 40381081204](https://github.com/probonolaw/Probono-Law-File-Operations/actions/runs/40381081204)
  verified and published the completed source run's exact artifacts. The same
  digests were imported into Production. Temporary CI publishing changes were
  removed in commit `a7705a8`; the final PR tests and builds passed in
  [run 40382958484](https://github.com/probonolaw/Probono-Law-File-Operations/actions/runs/40382958484).
- Both deployed runtimes passed Blob, Queue, and Table create/read/write/delete
  checks. Probe data was removed. C# workers' mounted configuration references the
  new accounts, and each environment recorded 36 main checkpoint writes and 12
  evidence-event checkpoint writes after cutover. No storage authorization
  errors were found in the sampled ingestion, gateway, and evidence workers.

Both registries deploy these immutable image digests:

| Image | Digest |
| --- | --- |
| `file-operations` | `sha256:6d3ee805b17d5872e1fd8ba09934cea599c983faf73b61dd967bfef4bbed8f1d` |
| `file-operations-data-ingestion` | `sha256:2412bb537a51c2da672d2ca496c90242092fc5bb56d4112508f9b34866740bc1` |

The reviewed cutover script is `scripts/invoke-file-storage-cutover.ps1`. It
requires an active migration identity record and two deployed image digests;
verifies all 12 deployments and the scheduled sync use those images; pauses
writers; synchronizes the five File Operations Data Automation containers,
integrity-cache data, ingestion table, and queues; changes Key Vault settings to
service URLs; and restores the original replica counts and schedule. Queue copy
retains source messages, preserves duplicate payloads and remaining TTL, verifies
the full destination multiset, and restores visibility. Azure-generated message
IDs, insertion times, dequeue counts, Table ETags, and timestamps cannot be copied.

Do not rerun the complete Data Automation profile after Operations cutover. Its
seven Operations containers now have active destination writers. The cutover
script uses a separate ledger/profile containing only the five File Operations
containers.

## External reader checks and source retention

- Content Understanding could not fetch a SAS URL through the destination
  firewall (`ContentSourceNotAccessible`). Sending the input contents through the
  existing analysis API succeeded. The application change streams base64 JSON
  without buffering the complete file and preserves model-deployment mappings.
- No input snapshots existed at inventory. Test had 34 succeeded and one failed
  Content Understanding journal; Production had none.
- Video Indexer successfully processed a synthetic audio file from each new
  general-data account using managed identity. Both test jobs and input
  containers were deleted afterward.
- Azure rejected an attempted Test Video Indexer storage relink with HTTP 400,
  `INVALID_INPUT`: “Can't change an existing connected Storage.” The existing
  binding and account ID were retained. Existing Test videos were all processed
  (24 videos). The user subsequently selected replacement accounts and reindexing;
  see the [replacement plan](video-indexer-replacement-plan.md). The original
  accounts remain active until that plan is executed and verified.
- Existing portal feedback records and some integrity-cache extraction results
  contain absolute source Blob URLs. The source accounts remain available for
  those references; they must not be deleted based solely on successful copying.

## Temporary migration access

Both dedicated migration identities, federated credentials, service accounts,
pods, custom source-reader roles, and all 18 temporary role assignments were
removed. Cleanup completed at 19:13 UTC in Test and 19:19 UTC in Production.
Azure read-back confirmed the temporary identities, role definitions, and
assignments no longer exist. Each queue journal had zero pending visibility
receipts and six verified queues before its pod was deleted.

Source read grants were at resource-group scope so backup deletion locks did not
need removal. Temporary Queue Data Contributor grants allowed receiving and
restoring source message visibility. Both runtime reader validation pods were
also deleted. No temporary operator IP allow rules were added.

The requested runtime RBAC and data migrations are complete in both environments.
Source accounts remain for the documented Video Indexer, stored-URL, operational
history, and retention dependencies. No source account was deleted during this
execution. Merge the application PR before a subsequent main-branch image
deployment so future builds retain support for the service-URL configuration.

## Subsequent user decisions

The user confirmed preserving the newer destination AIMIE agent configuration,
matching the completed migration. The user also selected planning replacement
Video Indexer accounts and reindexing in both environments. A later read-only
inventory found 24 Test and 12 Production videos, all Processed; no replacement
VI resources or reindexing jobs were created as part of that planning work.
