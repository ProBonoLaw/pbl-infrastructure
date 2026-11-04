# AIMIE Service and AIMIE Config storage

See [the 26 October execution record](storage-migration-execution-2026-10-26.md)
for the live AIMIE runtime cutovers, verified historical data merges, and retained
source data. The original migration plan follows.

## Destination and inventory

The consolidation pairs **AIMIE Service with AIMIE Config** in North Central US beside AKS. Test uses `aimiedatatestsuffix`; the Production counterpart is `aimiedataprodsuffix`. Test Data Automation, integrity-cache, and portal use the separate `probonolawdatatestsuffix` destination.

Both stacks now enable `stageSharedStorageNorthCentral` for their two destinations. Production initially used `stageAimieStorageNorthCentral` to provision AIMIE alone; that flag remains available for AIMIE-only staging. Both AIMIE accounts use `Standard_RAGRS`, Blob soft deletion, a private `agents` container, and Blob/Queue/Table private endpoints in their environment's AKS VNet. The account name is exported as `sharedAimieStorageAccountName`. Source accounts and their endpoints remain until cutover and retention are resolved.

## RBAC and network access

Both AIMIE destinations set `allowSharedKeyAccess: false`, `allowBlobPublicAccess: false`, `defaultToOAuthAuthentication: true`, and `publicNetworkAccess: Disabled`. Applications authenticate through Microsoft Entra workload identity and reach Blob, Queue, and Table through private endpoints.

| Environment | Workload managed identity | Client ID | Principal ID |
| --- | --- | --- | --- |
| Test | `aimie-service-test-workload` | `00000000-0000-4000-8000-000000000005` | `00000000-0000-4000-8000-000000000006` |
| Production | `aimie-service-workload-prod` | `00000000-0000-4000-8000-000000000007` | `00000000-0000-4000-8000-000000000008` |

Each identity receives **Storage Blob Data Owner**, **Storage Queue Data Contributor**, and **Storage Table Data Contributor**, scoped to its own consolidated account. Blob Data Owner supports the Functions/Durable host. No Storage Account Contributor grant is added: account management permission does not itself authorize these data operations. Pulumi manages the grants in `src/sharedStorageApplicationAccess.ts`.

Each identity also has an explicit **Storage Blob Data Owner** assignment on its own account's `blobServices/default/containers/agents` scope, as requested. Azure role assignments use the principal IDs above; the supplied client IDs identify the corresponding workload identities. Account-level host permissions remain in place.

Verify actual data access from the existing AIMIE pod, with uniquely named temporary probes that are deleted afterward:

```powershell
Get-Content scripts/check-aimie-storage-access.py -Raw | kubectl --context probono-law-aks-test-nc -n aimie-operations exec -i deploy/aimie-service -- python - aimiedatatestsuffix
Get-Content scripts/check-aimie-storage-access.py -Raw | kubectl --context probono-law-aks-prod -n aimie-operations exec -i deploy/aimie-service -- python - aimiedataprodsuffix
```

The check explicitly uses `WorkloadIdentityCredential`, verifies private DNS, and exercises create/write/read/delete operations in all three services. It never uses storage keys or reads application data.

Both commands passed against the running AIMIE pods on 24 October 2026. All probe containers, queues, and tables were deleted. Azure reported shared keys disabled, public network access disabled, public blobs disabled, OAuth selected by default, and all three private endpoint connections approved in each account. Test AIMIE health and portal health/staff/jurisdictions returned HTTP 200 after hardening. The earlier Test container-only Reader assignment was removed after verifying the account-level roles.

The initial Test update created six resources for the three data grants, updated the AIMIE security flags, and imported eight portal grants. Production created 21 resources for its account, private network access, and three data grants. The subsequent explicit `agents` ownership added a role assignment and naming deployment per environment. That stage passed graph verification for 478 Test and 546 Production resources; the transfer utility's ten tests also passed. Production general-data provisioning on 26 October is recorded in the [shared-storage runbook](shared-storage-northcentral-migration.md).

## Migration progress

On 24 October 2026, all **24 Test `agents` blobs (99,817 bytes)** were copied and verified. Test's protected `CONFIG_STORAGE_ACCOUNT` setting now points to `https://aimiedatatestsuffix.blob.core.windows.net`. AIMIE restarted successfully, and its workload identity could list all 24 configuration blobs and read a configuration document. The adjacent AIMIE deployment scripts now preserve the new configuration account and data permissions.

Test's `AzureWebJobsStorage` still points to `aimieserviceclxo2mycjfpl`. Production's configuration and Durable data have not been copied or cut over. Production's existing Durable source remains `aimieserviceobgbxpas4ai6`; disabling that source's shared keys before converting the host would interrupt the service.

Inventory on 24 October 2026:

| Source | Current location | Data |
| --- | --- | --- |
| `aimieconfigtestsuffix001` | Central US | One private container, `agents`: **24 blobs / 99,817 bytes**. No queues or tables. |
| `aimieserviceclxo2mycjfpl` | Central US | Eight containers, 51 queues, ten tables. Active `AimieServiceAksTest` Durable task hub plus historical hubs. |

The service reads configuration through `CONFIG_STORAGE_ACCOUNT` (a Blob service URL), with `CONFIG_STORAGE_ACCOUNT_CONTAINER` defaulting to `agents`. Durable storage currently uses the source `AzureWebJobsStorage` connection string. The configuration container name does not overlap the runtime's host/task-hub container names.

The active Test hub had two completed instances, 18 history rows, and 16 partition rows at inspection time. One instance output contains an absolute URL into the old account's `aimieserviceakstest-largemessages` container; it needs deliberate treatment during migration. Queue counts have not been verified, so this inventory is not evidence that the hub is drained. Historical task hubs and host secrets also remain in the source.

## Copy configuration

Use the virtual environment and dependencies described in the [main migration runbook](shared-storage-northcentral-migration.md#transfer-tool). Run from a host with network access to both accounts and Blob read/tag-read on the source and Blob write/read/tag permissions on the destination. This profile does not access Table storage.

Read-only inventory:

```powershell
.\.venv-storage-migration\Scripts\python.exe scripts/copy-storage-data.py --plan deploy/storage-migration/test-aimie.json --source aimieConfig
```

After provisioning the destination and freezing configuration updates:

```powershell
.\.venv-storage-migration\Scripts\python.exe scripts/copy-storage-data.py --plan deploy/storage-migration/test-aimie.json --source aimieConfig --copy
```

The copy verifies blob contents, metadata, tags, and content headers. Identical blobs can resume; conflicting destination blobs fail without overwrite. Preserve all configuration blob names and the `agents` container name. Keep the source for any required versions/snapshots or rollback; the tool copies current blobs only.

## Service and configuration cutover

1. Preview/apply the Test infrastructure and verify the exported AIMIE name matches `test-aimie.json`. Validate private DNS and access from AKS. The general data account must not be used for AIMIE settings.
2. Identify all configuration readers and writers. AIMIE's workload identity now has the three destination data roles described above; migrate any separate configuration writer identity as needed. The Test bootstrap uses the new account. Check configuration URLs and account references before each environment's cutover.
3. Stop new orchestration requests and drain the active `AimieServiceAksTest` hub, including timers and external-event waits, or use a supported coordinated Durable state migration. Retain required historical hubs and completed-instance status/history. An empty new account does not provide old instance status URLs or history. The generic Blob/Table copier is not a Durable state migration tool and has no AIMIE Service runtime profile.
4. Copy and verify `agents` while configuration writes are frozen. Transfer runtime state/host secrets only using the selected supported cutover procedure. Preserve or deliberately rotate host keys and update callers where needed. Do not independently copy live Durable queues, tables, and blobs.
5. Convert the host to identity-based storage settings for the destination Blob/Queue/Table service URIs and remove the old `AzureWebJobsStorage` connection string. Validate the deployed Functions host's support for AKS workload identity; do not assume an IMDS managed-identity credential can use the projected AKS token. Test already uses `CONFIG_STORAGE_ACCOUNT=https://aimiedatatestsuffix.blob.core.windows.net`. Preserve `CONFIG_STORAGE_ACCOUNT_CONTAINER=agents` and the task-hub/host identities appropriate to the chosen transition. Update deployment validation to accept only the correct destination and identity settings. Publish through the existing protected Key Vault flow.
6. Restart the service to reload configuration and clear in-process config caches. Verify agent configuration loads, an AIMIE request, status polling, and recovery after a restart. Confirm new Durable writes and config reads reach the AIMIE destination. Keep old and new workers from processing the same business request twice.
7. Remove the two source accounts, endpoints, and obsolete grants only after consumers, histories, host keys, stored URLs, and retention requirements are accounted for. For rollback after new work starts, drain or recover that new work before switching back to an older state store.

Production's destination is staged independently. Its configuration tooling still enforces the existing Production Durable source; a Production runtime migration must explicitly update that guard and use Production data. Test configuration migration and account permissions are complete; Durable state migration and Production data cutover remain pending.
