# Video Indexer replacement and reindexing plan

## Decision and current status

The user selected replacement Video Indexer accounts and reindexing for Test and
Production on 26 October 2026 and authorized execution on 27 October. Both
replacements are running, all 36 videos were reindexed and verified, and the old
Video Indexer and integrity-cache accounts were deleted. See the
[27 October execution record](storage-retirement-execution-2026-10-27.md).
The remainder of this document preserves the original plan and its earlier state.

The storage migrations are complete. File Operations reads and writes the new
North Central US accounts. Existing Video Indexer accounts still store their
managed assets in the original integrity-cache accounts because Azure rejected
changing their connected storage with `INVALID_INPUT`: "Can't change an existing
connected Storage."

The newer AIMIE destination configuration remains authoritative. Its 24 agent
files per environment were preserved during the completed migration, consistent
with the user's subsequent confirmation.

## Verified inventory

Read through the existing AKS workload identities on 26 October 2026 at about
21:29 UTC, using account-scoped Reader tokens and paginated Video Indexer lists.

| Item | Test | Production |
| --- | --- | --- |
| Subscription | `00000000-0000-4000-8000-000000000003` | `00000000-0000-4000-8000-000000000002` |
| Current resource name | `video-indexer-testsuffix001` | `video-indexer-prodsuffix001` |
| Current data-plane account ID | `00000000-0000-4000-8000-00000000000c` | `00000000-0000-4000-8000-00000000000d` |
| Current region / resource group | East US / `video-indexer` | East US / `video-indexer` |
| Current connected storage, Central US | `integritycachetestsuffix` | `integritycacheprodsuffix` |
| Proposed replacement resource name | `video-indexer-v2-testsuffix001` | `video-indexer-v2-prodsuffix001` |
| Target connected storage, North Central US | `probonolawdatatestsuffix` | `probonolawdataprodsuffix` |
| Existing videos | 24, all Processed | 12, all Processed |
| Total media duration | 10,035 seconds / 167.25 minutes | 4,029 seconds / 67.15 minutes |
| Indexing presets | 23 Default; 1 Advanced | 12 Default |
| Streaming preset / privacy / language | All Default / Private / en-US | All Default / Private / en-US |
| Videos reporting available source media | 24 | 12 |
| Videos missing an external ID | 3 | 0 |

All videos return a person-model ID; determine which refer to default models and
which require custom-model migration. Source-file availability is an API flag;
execution must still download or read, hash, and validate each original.

The current media inventory totals 234.4 minutes. This is a sizing baseline, not
a price estimate or a cumulative usage counter. Price the actual presets,
streaming, storage, regional transfer, retries, and new arrivals before the bulk
run. Preserve the Advanced item rather than applying the global Default setting
to every historical video.

## Target architecture

- Keep the replacement Video Indexer services in **East US** for feature parity.
  The subscription's `Microsoft.VideoIndexer/accounts` provider does not list
  North Central US as supported. Existing East US accounts already connect to
  Central US storage, demonstrating that these resources need not share a region.
  Verify the proposed North Central US binding with a Test canary before bulk work.
- Bind each new account at creation to its environment's existing `probonolawdata`
  account in resource group `shared-storage-northcentral`. Preserve the new shared
  storage account and its application containers.
- Create a separate user-assigned identity for each replacement. Grant Blob Data
  Contributor on the corresponding shared account, matching the current working
  service identity. Verify managed-asset creation, indexing, streaming, and cleanup
  with that role. Microsoft's portal setup assigns Blob Data Owner; if Contributor
  does not satisfy a required operation, capture the denied operation and establish
  the required role before proceeding. The VI identity needs no Queue or Table role.
- Assign the existing File Operations workload identity the custom token-generator
  role at the new VI resource scope in **both** subscriptions. Its actions are
  `Microsoft.VideoIndexer/accounts/read` and
  `Microsoft.VideoIndexer/accounts/generateAccessToken/action`. Keep old-account
  assignments through the transition.
- Create the new VI private endpoint in the existing North Central US
  `aks-northcentral/private-endpoints` subnet. Reuse
  `privatelink.api.videoindexer.ai` and its AKS VNet link, creating a distinct A
  record for the new account. Set VI public network access to Disabled.
- Retain storage's default-deny firewall, trusted Azure services exception,
  shared-key prohibition, and anonymous-Blob prohibition. The VI managed service
  accesses storage through the trusted-service path; its API private endpoint
  provides the separate AKS-to-VI path.
- Add the replacement as a parallel Pulumi resource with a distinct logical name.
  Keep the imported current resource, data-plane account ID, private endpoint,
  identity, and storage association. A preview must show additions for the
  replacement and no replacement/deletion of current VI or shared storage.

## Implementation sequence

### 1. Prepare the manifest and infrastructure changes

1. Add parallel resource creation to `src/videoIndexer.ts` (or a separate module),
   with an explicit per-environment enable flag and outputs for the new ARM ID,
   data-plane account ID, region, and identity. Reuse the shared-storage subnet
   output. Record the server-issued data-plane account ID after deployment.
2. Add new account-scoped token-role assignments for Test and Production. Existing
   `src/services/data-integrity-extractor/index.ts` manages the imported Test
   assignment; the replacement must not reuse its hard-coded old resource ID or
   silently skip Production.
3. Build a resumable migration runner using a dedicated, short-lived workload
   identity. Restrict source access to reading/exporting videos and source media;
   grant only the target writes and token generation needed for migration. Keep
   access tokens, SAS URLs, and media contents out of logs and Git.
4. Create one durable manifest row per old account ID and video ID, with:
   original external ID; canonical application account/source/path; media SHA-256,
   length and version/ETag; language; indexing/streaming presets; model mappings;
   archive locations; new account/video IDs; status, attempts and verification.
   Record work durably before submission and immediately after receiving an ID.
5. Match originals to verified blobs already copied into `probonolawdata`. Where
   necessary, export the original media using the old VI API into a dedicated
   migration input container and verify its bytes. Do not treat opaque copied
   VI-managed containers as a registered video library in the new account.
6. Resolve the three Test items without external IDs explicitly. The application's
   external ID is SHA-256 of `AccountId|SourceId|FilePath`, with `|advanced` appended
   for HighRes requests. Preserve existing external IDs and reconstruct missing
   ones only from verified application identity. Record any intentionally archival
   item separately. Filename alone is insufficient to establish identity.
7. Export original insights, captions, metadata, human corrections, and relevant
   custom person/language/brand models before reindexing. Preserve this archive:
   new model results, speaker IDs, timestamps, and video IDs may differ. Recreate
   supported customizations and record old-to-new model IDs; resolve any unsupported
   customization before its affected items are considered migrated.

### 2. Deploy and validate Test

1. Deploy the Test replacement, private endpoint, DNS record, identity and roles.
   Confirm AKS resolves the account-specific hostname to its new private IP.
2. From the actual workload identity, generate an account token and submit a
   synthetic private input from `probonolawdatatestsuffix` using managed-identity
   download. Verify Processed state, insights and the required streaming behavior.
   Confirm the account's ARM storage binding and the resulting managed assets use
   the new account. Remove only the owned synthetic job/input after verification.
3. Start the historical run with concurrency one, then increase only within the
   account's observed quota. Honor Retry-After and back off on 429/5xx. On ambiguous
   submission outcomes, reconcile by external ID before resubmitting. On a duplicate
   response, verify media identity and preset before recording the existing new ID.
4. Reindex every manifest item with its original settings and model mapping. Keep
   per-item failures visible and retryable. The initial acceptance count is 24,
   adjusted only by a recorded final inventory of new arrivals or resolved aliases.
5. Verify every old ID has a valid mapping, its new video is Processed, source
   duration and identity match, and required transcripts, speakers, captions and
   playback work. Review changed insights; retain the historical versions.

### 3. Switch Test runtime, then repeat in Production

1. Keep the deployed workload-identity client changes from File Operations PR 89
   in future builds. Update its source deployment configuration as well as Key Vault.
2. Pause new media submissions and drain in-flight Video Indexer requests before
   switching. The current client submits and polls using global VI configuration;
   a video ID is meaningful in its original account. Preserve Event Hub checkpoints
   and pending work while the consumers are paused. Reconcile the final source
   inventory and migrate any newly completed items.
3. Write a new version of `file-operations-appsettings` in `probonolawakssecrets`
   for Test, recording the previous version. Update the VI account name and ID;
   explicitly verify location, subscription, resource group and ARM API version.
   Keep workload-identity token generation. The fields are:
   `VIDEO_INDEXER_ACCOUNT_NAME`, `VIDEO_INDEXER_ACCOUNT_ID`,
   `VIDEO_INDEXER_LOCATION`, `VIDEO_INDEXER_SUBSCRIPTION_ID`,
   `VIDEO_INDEXER_RESOURCE_GROUP`, and `VIDEO_INDEXER_ARM_API_VERSION`.
4. Roll out the affected Data Integrity/File Operations consumers, verify their
   mounted settings and new video submission/poll/Markdown output, then restore
   the recorded replicas and schedules. Observe one full normal processing cycle
   with no VI authorization, source-download, polling or output failures.
5. Apply the same completed procedure to Production using `probonolawakssecretsprod`
   and its own manifest. Its initial inventory is 12 videos. Reconcile arrivals
   again at the Production pause rather than relying on today's count.

### 4. Resolve references and retire the old resources

1. Locate references to old VI account/video IDs and absolute integrity-cache URLs
   in application records, cached results, Markdown, embedded links and integration
   settings. Use the verified mapping to update live references with conditional
   writes and an audit record. Regenerate expiring playback/download URLs from the
   new account rather than storing old signed URLs. Preserve historical evidence.
2. Confirm no runtime still generates tokens or submits/polls against old VI, no
   source-only original remains, every intended video is verified, and every live
   reference is migrated or has an explicit retained dependency.
3. Complete the agreed operational observation and rollback window, then remove
   temporary migration access. Retain both VI accounts until rollback is no longer
   needed; revoking the old service's storage role early would break its assets.
4. Retire old VI accounts/endpoints/identities through a separate reviewed deletion
   change. Delete an integrity-cache storage account only after its non-VI URL,
   operational-history, backup-lock and retention dependencies are also resolved.
   Successful reindexing alone does not establish that the whole account is unused.

## Rollback and completion criteria

Before switching, save the old VI configuration, Key Vault version, deployment
replicas and schedules. If verification fails, pause admissions and drain work
against the new account before restoring the old configuration and rolling back
the affected consumers. Retain the new account and its mappings for any jobs
already created there. Never send a new-account video ID to the old account.

Completion requires verified manifests for both environments, working new-job
submission and output, all required reference/model migrations, restored workloads,
and removal of temporary access. Source deletion is a subsequent step with its own
dependency and retention evidence. The completed storage migration remains valid
while this replacement plan is implemented.

## Sources and evidence

- Azure ARM account properties and provider locations, read 26 October 2026.
- Paginated VI inventories obtained using the actual Test and Production AKS
  identities; summarized above without media names or access credentials.
- [Storage migration execution record](storage-migration-execution-2026-10-26.md).
- [Create a Video Indexer account](https://learn.microsoft.com/en-us/azure/azure-video-indexer/create-account).
- [Storage behind a firewall](https://learn.microsoft.com/en-us/azure/azure-video-indexer/storage-behind-firewall).
- [Video Indexer private endpoints](https://learn.microsoft.com/en-us/azure/azure-video-indexer/private-endpoint-overview).
