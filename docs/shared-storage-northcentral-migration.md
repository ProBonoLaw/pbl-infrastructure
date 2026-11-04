# Shared storage in North Central US

For the latest live authorization, data-copy, cutover, and retention status, see
[the 26 October execution record](storage-migration-execution-2026-10-26.md).
The dated provisioning sections below describe their state at deployment time.

## Scope and current state

Both environments have separate general-data and AIMIE destinations in North Central US, colocated with AKS:

| Environment | Destination | Sources |
| --- | --- | --- |
| Test | `probonolawdatatestsuffix` | Data Automation, integrity-cache, and portal |
| Test | `aimiedatatestsuffix` | AIMIE Service and AIMIE Config |
| Production | `probonolawdataprodsuffix` | Production Data Automation, integrity-cache, and portal |
| Production | `aimiedataprodsuffix` | Production AIMIE Service and AIMIE Config |

This incorporates the revised direction to combine AIMIE Service with AIMIE Config. Production notification and Markdown storage were deleted on 24 October 2026. Production initially staged AIMIE only; the 26 October request also enables `stageSharedStorageNorthCentral` to provision `probonolawdataprodsuffix`.

`Pulumi.test.yaml` enables `stageSharedStorageNorthCentral`. This adds:

- Resource group `shared-storage-northcentral`.
- Storage accounts `probonolawdatatestsuffix` and `aimiedatatestsuffix` (exported as `sharedDataStorageAccountName` and `sharedAimieStorageAccountName`). Both names were available on 24 October 2026.
- `Standard_RAGRS` replication, preserving integrity-cache's and AIMIE Config's geo redundancy, with Blob soft deletion. The data account has 14-day file-share deletion retention; AIMIE uses the helper's seven-day default. Neither account provisions file shares.
- Subnet `private-endpoints`, `172.28.243.128/25`, in the existing `aks-northcentral` VNet. The AKS node subnet is the other `/25`; the destination range was unoccupied at review time.
- Three private endpoints per account for Blob, Queue, and Table, using existing private DNS zones already linked to AKS. No Azure Files endpoints are added.

Both general-data accounts disable shared keys and retain a default-deny storage firewall with the Azure trusted-services exception for Video Indexer. Both AIMIE destinations disable public network access and shared-key authorization. Private endpoints support AKS access to all four accounts. Each AIMIE workload identity has account-scoped Blob Data Owner, Queue Data Contributor, and Table Data Contributor roles. Each File Operations identity has Blob, Queue, and Table Data Contributor on its general-data account. Each portal identity has eight grants scoped to its two containers and six tables.

All five Test source accounts, endpoints, and the current Video Indexer storage binding remain until their migrations and retention requirements are resolved. Keep the staging flags enabled as the accounts become destinations.

### Completed on 24 October 2026

- Created both Test accounts and six private endpoints; AKS resolves their services to the new private subnet.
- Created Production's separate AIMIE account and its three private endpoints. Verified Blob, Queue, and Table create/write/read/delete access from the Test and Production AIMIE pods using workload identity. Both AIMIE accounts disable shared keys and public access; all temporary verification data was deleted.
- Copied and verified all 10 portal blobs and 840 table entities under a write freeze. Switched the backend's `STORAGE_ACCOUNT_NAME` to `probonolawdatatestsuffix`, restored two replicas, and verified public health, staff, and jurisdiction endpoints returned HTTP 200.
- Copied and verified all 24 AIMIE configuration blobs. Changed only `CONFIG_STORAGE_ACCOUNT` in the protected Test app settings to `https://aimiedatatestsuffix.blob.core.windows.net`, restarted AIMIE, and verified configuration access using its workload identity. Durable storage still uses its original source.
- Removed four temporary migration roles and both temporary operator IP rules. The Data Automation backup deletion lock was briefly removed to delete the temporary Table Reader role and then restored with its original level and notes. Backup contents and retention were not changed.

Portal's old account remains because feedback records can contain absolute source blob URLs, including records outside Table storage. AIMIE runtime migration, Data Automation migration, and integrity-cache/Video Indexer migration remain pending.

### Production general-data provisioning — 26 October 2026

`probonolawdataprodsuffix` uses the existing `shared-storage-northcentral` resource group and `private-endpoints` subnet. It has `Standard_RAGRS`, Blob soft deletion, private Blob/Queue/Table endpoints, disabled shared keys and public network access, and OAuth authentication selected by default.

The destination prepares 17 empty containers: `exhibits`, `input`, `results`, the 12 current Operations containers listed below, and the two portal containers. It also prepares the six portal tables and `IngestionProgress`. No blobs, table entities, queues, legacy Functions containers, or file shares are migrated by this provisioning step.

The 22 Production role assignments are managed in `src/productionSharedDataStorageAccess.ts`:

| Workload identity | Destination access |
| --- | --- |
| `account-operations-prod-workload` | Blob Data Contributor on the two Account Operations containers |
| `account-operations-email-prod-workload` | Blob Data Contributor on the same two Account Operations containers |
| `aimie-operations-prod-workload` | Blob Data Contributor on the three AIMIE Operations containers |
| `email-operations-prod-workload` | Blob Data Contributor on the two Email Operations containers; Blob Data Reader on `aimie-operations-results` |
| `probonolaw-ui-runtime-prod` | Blob Data Contributor on the two portal containers; Table Data Contributor on the six portal tables |
| `file-operations-prod-workload` | Blob, Queue, and Table Data Contributor on the account, supporting dynamic evidence containers/queues and ingestion state |
| Existing Video Indexer identity | Preparatory Blob Data Contributor on the account |

At initial provisioning, Production workloads still used their source endpoints. Subsequent cutovers and external reader checks are recorded in the execution record above. Video Indexer remains bound to `integritycacheprodsuffix`: Azure rejects changing an existing connected storage account. Both general-data accounts now permit the [trusted Azure service access](https://learn.microsoft.com/en-us/azure/azure-video-indexer/storage-behind-firewall) needed to fetch input with Video Indexer's managed identity, while retaining a default-deny firewall and disabled shared keys.

Provisioning completed on 26 October. Azure verification confirmed all 22 intended grants for seven workload identities, disabled shared keys/public access, and three approved private endpoints. From AKS, a temporary pod using the File Operations service account successfully created, wrote, read, and deleted Blob, Queue, and Table test data. DNS resolved Blob to `172.28.243.135`, Queue to `172.28.243.137`, and Table to `172.28.243.136`. All test data and the temporary pod were deleted; no temporary operator roles or firewall exceptions were added.

The deployment adds 80 managed resources in total. An initial update stopped after an ARM deployment-name truncation collision; shortened checkpoint grant names fixed it, and the follow-up update completed and removed seven obsolete empty naming deployments. A graph check now rejects duplicate ARM deployment names. The final graphs passed for 478 Test and 626 Production resources. Existing source resources and application bindings were not changed by this rollout.

## Source inventory and selection

Live Test inventory on 24 October 2026:

| Source | Containers | Queues | Tables | Migration scope |
| --- | ---: | ---: | ---: | --- |
| `dataautomationlasnn5vo5p` | 144 | 5 | 634 | **Only** the 12 current AKS data containers and `IngestionProgress` listed below. |
| `integritycachetestsuffix` | 57 | 6 | 0 | Application data, evidence state, and Video Indexer assets require coordinated migration. |
| `aimieserviceclxo2mycjfpl` | 8 | 51 | 10 | Moves to the **AIMIE destination** after a drained or otherwise supported Durable state transition. |
| `aimieconfigtestsuffix001` | 1 | 0 | 0 | Copy `agents` to the **AIMIE destination**: 24 blobs, 99,817 bytes. |
| `probonolawportal7n5eya35` | 2 | 0 | 6 | Transfer both containers and all six tables. Inventory read found **10 blobs and 840 entities**. |

The data-account copy allowlists are versioned in [deploy/storage-migration/test.json](../deploy/storage-migration/test.json). The separate [AIMIE plan](../deploy/storage-migration/test-aimie.json) copies AIMIE Config's `agents` container to the AIMIE destination; its [runbook](aimie-storage-northcentral-migration.md) covers Durable state and configuration cutover. The data-account allowlists include:

- **Portal containers:** `feedback-images`, `staffphotos`.
- **Portal tables:** `betatester`, `federaljurisdictions`, `newsletter`, `staff`, `statejurisdictions`, `tribaljurisdictions`.
- **Data Automation containers:** `account-operations-checkpoints`, `account-operations-failed-events`, `aimie-operations-checkpoints`, `aimie-operations-failed-events`, `aimie-operations-results`, `email-operations-checkpoints`, `email-operations-failed-events`, `file-operations-checkpoints`, `file-operations-evidence-checkpoints`, `file-operations-evidence-event-checkpoints`, `file-operations-failed-events`, `file-operations-sync-state`.
- **Data Automation table:** `IngestionProgress`. Current File Operations `src/FileOperations/IngestionFlow.cs` still uses this table through `TABLE_CONNECTION_STRING` and `TABLE_NAME`.

Data Automation excludes all `flow*` containers/tables/queues, `azure-webjobs-*` containers, `AzureFunctions*` tables, old content/deployment file shares, and local-development Email Operations containers. The copy tool uses explicit names and rejects Functions/Logic App runtime names for Data Automation. It has no queue or file-share copy path. Do not copy the Data Automation account wholesale.

AIMIE's currently active Durable runtime belongs to the separate AIMIE destination and must retain its state through a controlled cutover. Data Automation's legacy runtime data remains excluded.

## Transfer tool

Use Python 3.11 or newer. Install dependencies into a virtual environment and run the tests:

```powershell
python -m venv .venv-storage-migration
.\.venv-storage-migration\Scripts\python.exe -m pip install -r scripts/requirements-storage-migration.txt
.\.venv-storage-migration\Scripts\python.exe scripts/test-copy-storage-data.py
```

Run from a host that can resolve and reach both source and destination storage endpoints. Authentication uses `DefaultAzureCredential`, including an Azure CLI login locally or AKS workload identity. The migration identity needs Blob read/tag-read and Table read access on the selected source data, plus Blob write/tag-write and Table create/write/read access at the destination. No account keys or SAS values are logged or stored in the plan.

The selected Data Automation inventory completed with temporary Table Reader access: **237,045 blobs in the 12 allowlisted containers and 3,126 entities in `IngestionProgress`**. No Data Automation data has been copied. Portal and AIMIE Config copies completed as recorded above. Future transfers require a private-network execution location and bounded migration permissions; the temporary operator permissions have been removed.

The default command inventories selected data only:

```powershell
.\.venv-storage-migration\Scripts\python.exe scripts/copy-storage-data.py --source portal
.\.venv-storage-migration\Scripts\python.exe scripts/copy-storage-data.py --source dataAutomation
```

After provisioning the destination, granting access, and freezing the selected source writers, execute the transfer:

```powershell
.\.venv-storage-migration\Scripts\python.exe scripts/copy-storage-data.py --source portal --copy
.\.venv-storage-migration\Scripts\python.exe scripts/copy-storage-data.py --source dataAutomation --copy
```

The tool preserves block-blob contents, metadata, tags, HTTP content headers, names, and Table keys and typed user properties. It verifies SHA-256 for each blob and compares copied entity values. Azure regenerates Table timestamps/ETags and blob service timestamps. Existing identical objects are verified and skipped; differing objects cause failure. Nothing is deleted or overwritten. The tool detects source changes encountered during copying, but a write freeze is still required for a consistent final transfer.

This is a final copy under a write freeze, not an online mirroring process. A retry can resume matching data; if writers have resumed and changed source data, reconcile destination conflicts deliberately before retrying. Snapshots, versions, soft-deleted data, access policies, queues, and file shares are not copied by this tool. Source retention is needed for any historical data that must remain accessible.

## Application cutover

1. **Provision and validate the target.** Preview/apply the Test stack. Verify the output account name matches the transfer plan, private DNS resolves Blob/Queue/Table to the new AKS subnet, and the migration identity can read/write the destination. The source accounts and Video Indexer binding must not be deleted/replaced in this update.
2. **Portal.** Grant its current runtime identity the needed permissions on the destination containers/tables. Freeze portal writes, run and verify the portal copy, and change the backend's `STORAGE_ACCOUNT_NAME` to the new account. Preserve table/container names. Exercise staff photos, jurisdictions, beta signup, newsletter signup, and feedback uploads. Feedback upload code persists absolute `blobClient.url` values: update or translate those stored references before retiring the old account, including references held outside Azure Tables. Copying blobs alone does not change stored URLs.
3. **Data Automation consumers.** Inventory the deployed settings for Account, AIMIE Operations, Email, and File Operations. Stop all consumers/producers that write the selected containers/table, copy the allowlist, then update `CHECKPOINT_BLOB_CONTAINER_URI`, `FAILED_EVENTS_BLOB_CONTAINER_URI`, `OUTPUT_BLOB_CONTAINER_URI`, `CHECKPOINT_STORAGE_CONNECTION_STRING`, and File Operations `TABLE_CONNECTION_STRING` as applicable. Keep existing consumer groups and checkpoint metadata. Resume once and confirm offset continuity, failed-event recovery, generated results, and ingestion/sync state. Do not run old and new processors concurrently against independent checkpoint stores.
4. **Integrity cache and Video Indexer.** Inventory current Blob URLs and the six evidence queues (`evidence-finalize`, `evidence-gather`, `evidence-poison`, `evidence-reconcile`, `evidence-repair`, `evidence-review`). Drain or reliably replay pending evidence work before changing endpoints. Copy and verify the selected application blobs and Video Indexer assets. Validate the supported Video Indexer storage transition and playback/indexing of existing videos before changing its `storageServices.resourceId`; pregrant the Video Indexer identity Blob Data Contributor at the destination. New uploads from firewall-protected storage require its documented managed-identity download path. Source account URLs embedded in records or SAS URLs need explicit treatment.
5. **AIMIE Service and AIMIE Config.** Follow the [separate AIMIE migration runbook](aimie-storage-northcentral-migration.md). Test's 24 `agents` blobs and configuration reader have moved. Coordinate the `AimieServiceAksTest` Durable state transition and replace the source connection string with verified identity-based host settings. The general data-account plan does not include AIMIE data.
6. **Retire source resources after verification.** Confirm no current AKS setting, application URL, Video Indexer binding, or required backup references each old account. Data Automation's protected legacy content shares stay in their existing vault/source for their required retention; they are excluded from the new account. Removing old accounts and changing backup retention are separate final steps after the working migration is verified.

The portal and Test AIMIE configuration reader use the new destinations. Data Automation, integrity-cache/Video Indexer, and AIMIE Durable continue to use their sources. The copy utility is suitable for the completed small transfers; a bulk baseline plus a coordinated final write freeze is needed for the much larger Data Automation selection.
