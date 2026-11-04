# Storage retirement — 27 October 2026

## Scope and status

All 15 identified old storage accounts and both old Video Indexer accounts have
been deleted in Test and Production. The owner authorized deletion of the old storage
accounts, retirement of the legacy Data Automation backups, and replacement and
reindexing of both Video Indexer libraries before deleting integrity-cache.

The first deletion stage completed in both environments: four Test and eight
Production application storage accounts and their endpoints were removed through
Pulumi. The unused, empty Test Video Indexer storage account was deleted separately
after confirming it was absent from Pulumi state. The final deletion stage removed
both integrity-cache accounts and old Video Indexer services after verified runtime
cutovers. Azure inventories confirm that only the two retained accounts remain in
each environment.

The four retained storage accounts are in North Central US:

| Environment | Application data | Combined AIMIE Service and Config |
| --- | --- | --- |
| Test | `probonolawdatatestsuffix` | `aimiedatatestsuffix` |
| Production | `probonolawdataprodsuffix` | `aimiedataprodsuffix` |

The retirement inventory contains 15 accounts:

| Former purpose | Test source | Production source |
| --- | --- | --- |
| AIMIE Config | `aimieconfigtestsuffix001` | `aimieconfigprodsuffix001` |
| AIMIE Service | `aimieserviceclxo2mycjfpl` | `aimieserviceobgbxpas4ai6` |
| Portal | `probonolawportal7n5eya35` | `probonolawportalkc7ebqpb` |
| Data Automation | `dataautomationlasnn5vo5p` | `dataautomationlavdqzxqu4` |
| Integrity cache / old VI assets | `integritycachetestsuffix` | `integritycacheprodsuffix` |
| Empty orphan VI storage | `videoindexertestsuffixrv` | — |
| Data Ingestion | — | `dataingestionsvctq4ih3ga` |
| Data Integrity Extractor | — | `dataintegrityextractorrf` |
| Portal Starter | — | `portalstartertpusarwi` |
| Resource Manager | — | `resourcemanagerl7f5tq5g` |

## Data and dependency checks

- Rechecked the 14 remaining source accounts. None had new blob writes after the
  completed 26 October storage cutover. Current application data, portal tables,
  AIMIE history, ingestion progress and evidence queues had already been migrated
  and verified; see [the migration record](storage-migration-execution-2026-10-26.md).
- Preserved the authoritative 24 agent configuration files in each new AIMIE
  account. Their 26 October versions were unchanged by retirement.
- All four destinations still reject shared keys and anonymous Blob access.
  Test AIMIE retains its pre-existing operator-IP firewall exception documented
  in the prior migration record. This retirement did not change that exception.
- Excluded legacy Functions and Logic Apps data in Data Automation, as requested.
  The only Azure Files shares found belonged to those two retired applications.
- Archived additional Production history from Data Ingestion, Data Integrity,
  Portal Starter and Resource Manager. The private `retired-service-history`
  container in `probonolawdataprodsuffix` holds 126,068 table records and 695 blobs,
  including the remaining Portal Starter image. Every archive object was read back
  and SHA-256 verified. Host secrets, leases, partition ownership and diagnostic
  state were excluded.
- Scanned current Blob and Table data for source-account references, including
  evidence work and tasks, failure records, results and ingestion progress.
  Updated 55 Test result objects after verifying all 160 referenced destination
  assets. Conditional writes preserved concurrent changes; original objects and
  hash ledgers are in `storage-retirement-audit`.
- Scanned all containers in `db_conversation_history` for old portal/cache URLs
  and old VI account IDs. Updated screenshot URLs in four Test and six Production
  feedback records using ETag conditions. Original Cosmos records are archived
  privately in each environment's `storage-retirement-audit` container.
- AKS workload, ConfigMap, volume and scheduling inventories showed no active
  references to old storage accounts. File Operations already uses the new
  application data account; its Video Indexer account setting is cut over separately.

## Azure Backup

Deleted the protected Azure Files backup items for `dataautomationlasnn5vo5p` and
`dataautomationlavdqzxqu4`. Both DeleteBackupData jobs completed. Protection is
stopped and the items entered deferred deletion. Both vaults use Azure Backup's
Always On soft delete with 14-day retention; backup metadata is retained until
that service-managed period expires. The vaults remain.

Unregister requests returned `CloudInternalError`, but subsequent checks showed
that both `AzureBackupProtectionLock` resources had been removed. Test's storage
account deletions then succeeded in both environments. No Key Vault preservation
locks were removed.

## Video Indexer replacement

| Environment | Replacement | New data-plane account ID | Original videos |
| --- | --- | --- | ---: |
| Test | `video-indexer-v2-testsuffix001` | `00000000-0000-4000-8000-00000000000a` | 24 |
| Production | `video-indexer-v2-prodsuffix001` | `00000000-0000-4000-8000-00000000000b` | 12 |

The services remain in East US, where Video Indexer is supported. Their connected
storage and API private endpoints are in North Central US. Both API endpoints
disable public access. Each VI identity has Blob Data Contributor on its own
consolidated account. Both File Operations identities have the existing custom
token-generation role scoped to their replacement VI account.

Both replacements passed private-network indexing canaries. Original media is
downloaded, hashed, uploaded privately and read back for verification. Original
metadata, insights and captions are archived before reindexing. The per-video
manifests and old-to-new ID maps live in `video-indexer-retirement-archive` under
the old account ID; media is in `video-indexer-migration-input`.

All source videos use the default person model, with no enrolled people and no
custom language or brand models. Original language, privacy and streaming presets
are preserved. Test's Advanced video retains Advanced indexing. Three Test videos
without external IDs receive explicit archival identifiers. Six Test historical
entries share one external ID and identical media bytes; the newest retains the
application lookup key, and five receive distinct archival IDs so all six remain
separate records.

All 24 Test and 12 Production videos passed reindexing, duration and source-length
checks, plus private playback manifest checks. Runtime cutover is gated on full library
verification, paused admissions, a final source inventory and a canary through
the deployed Data Integrity service. The cutover script records replica counts,
cron state and Key Vault versions, preserves other settings, and uses workload
identity token generation.

The first Test runtime probe used WAV, which the deployed application's extraction
policy routes through Content Understanding. That attempt was rolled back and all
27 pods were restored. Its owned input, snapshots and operation journal were removed.
The corrected probe uses a valid AIFF file, which the same policy routes through
Video Indexer without changing application routing settings. Both the Test retry
and Production passed: the deployed services indexed the file in their replacement
account, produced Markdown and removed their owned test artifacts. Mounted settings,
all 27 File Operations pods per environment, and scheduled sync restoration were
verified. Static Video Indexer access tokens were removed from the settings.

## Infrastructure verification

- Document Intelligence (`cog-svc-*`) and Content Understanding's primary Foundry
  accounts remain active infrastructure dependencies. The
  [28 October follow-up](data-integrity-ai-dependencies-2026-10-28.md) maps all three
  Data Integrity AI services and records successful private Document Intelligence
  API checks in Test and Production.
- TypeScript and graph checks pass: 446 Test resources and 495 Production resources.
  Each graph has two storage accounts and 16 private endpoints.
- All 10 existing storage-copy tests pass.
- Full Azure previews contained only planned deletions and imports. Imported VI
  identity IDs preserve Azure's original casing; computed private endpoint
  connections are ignored to avoid an unnecessary account update.
- First-stage updates preserved old VI/cache resources: Test 60 deletions and
  six imports; Production 116 deletions and seven imports. Production also adopts
  the existing CI Reader grant on its new application data account.
- Final updates completed with 19 Test and 22 Production deletions and no creates,
  updates or imports. Final live verification confirmed the retained storage security,
  replacement VI bindings, private endpoints, persistent RBAC, library coverage and
  all runtime replicas. Private completion receipts accompany the library archives.
- After final verification, `cleanup-storage-retirement.ps1` removed both temporary
  workload identities, their federated credentials, pods and service accounts,
  22 ARM assignments, four Cosmos SQL assignments and two temporary source-reader
  custom roles. Follow-up reads confirmed that the temporary access was gone.
  Persistent application and replacement Video Indexer grants remain.

The execution records and encrypted Pulumi state backups are stored locally under
the operator's temporary directory with the `probonolaw-storage-retirement-`
prefix. No access tokens, signed download URLs, application settings or media
contents are committed to the repository.

## Review follow-up (29 October)

The operational tools now share their ARM/Cosmos grant plan in
`scripts/storage-retirement-grants.ps1`. Setup journals deterministic assignment
IDs before creation, including the existing Video Indexer token-generator role at
the `video-indexer` resource-group scope. Cosmos access is account-scoped Data
Reader plus Data Contributor limited to the feedback container. Resume reuses
the same assignment IDs; cleanup verifies their principal, scope and role before
removing them. Keep the shared helper beside both PowerShell scripts.

Rollback stops before writing old settings or resuming workloads when the Data
Integrity scale-down or pod-termination check fails. Its private journal records
the blocked step so an operator can finish draining the pods before recovery.
Canary video creation makes a single POST. After an uncertain response, reconcile
the canary's external ID against the replacement account before rerunning it.

Reindexing uses a 60-second Blob lease renewed every 15 seconds. Renewal failure
or local expiry stops further submissions and checkpoints. A killed process's
lock expires within 60 seconds of its last successful renewal; restart from the
existing private per-video manifests. An uncertain submission remains in
`Submitting` and is reconciled by external ID before any new POST.

Offline tests in `test-retirement-safety.py` and
`test-storage-retirement-safety.ps1` cover these failure cases in CI.
