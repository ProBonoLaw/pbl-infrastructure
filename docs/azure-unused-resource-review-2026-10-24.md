# Azure resource usage review — 24 October 2026

This initial inventory is historical. Later changes are recorded in the [storage retirement execution](storage-retirement-execution-2026-10-27.md) and [North Central US network consolidation](network-consolidation-2026-10-28.md). Their execution records supersede the pending recommendations below.

## Scope and method

Initial read-only review of the Test subscription `00000000-0000-4000-8000-000000000003` and Production subscription `00000000-0000-4000-8000-000000000002`, compared with this repository's Pulumi program. The review checked live resource types, storage transaction metrics by API, storage child resources, VNet subnets and peerings, private endpoints, private DNS records and links, Recovery Services protection, and Log Analytics `Usage`. Subsequent owner-authorized changes are recorded below and in the migration runbooks. Protected application settings were handled without logging their values.

Storage and Log Analytics measurements cover **24 September through 23 October 2026 UTC** (30 complete days). Transactions include service-property probes and do not by themselves prove that an application uses an account. Conversely, zero traffic during that window does not prove that stored data can be discarded.

Both subscriptions now have a Static Web App, Front Door, and AKS cluster, with no `Microsoft.Web/sites` or `Microsoft.Web/serverfarms` resources. Both stack files set `keepLegacyPortalWebApp: false`; Production also sets `productionApexFrontDoor: true`.

## Implemented after review

- Deleted the approved Production Markdown and notification storage accounts and their dedicated Blob/Queue/Table private endpoints and DNS groups. The deployment deleted 28 Pulumi resources; Web PubSub and telemetry remain.
- Created two Test storage destinations in North Central US. Copied and verified portal's 10 blobs and 840 table entities and AIMIE Config's 24 blobs, then switched their Test readers/writers. Source accounts remain for unresolved stored URLs, remaining consumers, and retention.
- Configured a Production AIMIE destination in North Central US and RBAC-only, private access for both AIMIE destinations. Each AIMIE workload identity receives Blob Data Owner, Queue Data Contributor, and Table Data Contributor on its own account.
- Inventoried the current Data Automation allowlist: 237,045 blobs and 3,126 table entities. No Data Automation legacy Functions data is selected. Data Automation, integrity-cache/Video Indexer, and AIMIE Durable migrations remain pending.
- Removed temporary migration access and restored the Data Automation backup protection lock after removing a temporary reader role. Backups and retention were retained.

## Strong retirement candidates

| Resource | Evidence | Before removal |
| --- | --- | --- |
| Test storage `videoindexertestsuffixrv` | 60 `GetBlobServiceProperties` calls and no other transaction APIs in 30 days. ARM lists no blob containers, file shares, queues, or tables. The live Video Indexer account binds `integritycachetestsuffix`, not this account. The extra account is absent from the Pulumi program. | Confirm no external/manual client or retained backup uses it. Its direct Blob Data Contributor assignment belongs to the Video Indexer identity and can be retired with the account. |
| Production VNet `data-ingestion-vnet` and resource group `shared-vnet-data-ingestion` | The VNet has no peering or private DNS link. Its only subnet, `aimie-notification-farm`, has no IP configuration or private endpoint. Its sole service association points to the deleted App Service plan `aimie-notificationfarmjngq43h5`. The VNet is absent from the current Pulumi program. | Check for external routing dependencies. Azure may require the stale `AppServiceLink` to be released before it permits subnet/VNet deletion. |
| App Service certificates | Production has `probono-law.com-probonolaw-portal-kc7ebqpb` and `www.probono-law.com-probonolaw-portal-kc7ebqpb`; Test has `test.probono-law.com-probonolaw-portal-7n5eya35`. No Web App or App Service plan remains in either subscription; Front Door manages the current public TLS. | Verify no certificate binding or export process still uses these App Service certificate resources. |
| Empty resource groups | `probono-law-requirement-fulfillment` and `web-site-data-ingestion` contain no ARM resources in either subscription. Both are still declared in `src/groups.ts`. | Remove the unused Pulumi group definitions through a reviewed preview. The Test `web-site-data-ingestion` **subnet** is a separate resource in the Logic VNet and still hosts a Search private endpoint. |
| Private DNS `privatelink.azurewebsites.net` | Each subscription's zone has only its SOA record and three VNet links. No Web App site or site private endpoint remains. The zone and links are still created by `src/foundation.ts`, `src/flexNetwork.ts`, and `src/aksNorthNetwork.ts`. | Remove the zone and links from Pulumi together, after confirming no future private App Service origin is planned. |
| Test private DNS `privatelink.files.core.windows.net` | This separate zone has one VNet link and a record `portalstartereiuiczbx-6ecfaytf-1` pointing to `10.0.7.5`. Test has no `portal-starter` account or subnet, and this zone is not in the current Pulumi program. | Check any manual DNS clients, then remove the stale zone/link/record. The actively used Azure Files zone is `privatelink.file.core.windows.net` (singular). |

## Empty subnets that need coordinated configuration changes

| Subnet | Live state | Dependency in current program |
| --- | --- | --- |
| Production `logic/aimie-search-56184-pe-subnet` | No IP configuration or private endpoint; the active Search endpoint is in `aimie-search-74239-pe-subnet`. | Not declared in current Pulumi source. Check stack state before direct deletion. |
| Test `logic/aks-test` | No IP configuration, private endpoint, or service association. The active AKS subnet is in `aks-northcentral`. | Not declared in current Pulumi source. Check stack state before direct deletion. |
| Both `flex/probonolaw-portal-consolidated` | Empty after Web App retirement. | Still declared in `src/flexNetwork.ts`; remove through Pulumi. |
| Both `flex/aimie-service-consolidated` | Empty. | The AIMIE storage firewall still allows this subnet. Remove that rule before removing the subnet; AKS reaches the storage through private endpoints. |
| Both `logic/data-integrity-extractor-server-farm` | Empty and delegated to App Service. | Production Data Integrity and Data Ingestion storage firewalls and Document Ingress ACL still reference it. Remove those rules with a reviewed Pulumi change before removing the subnet. |

The other three primary VNets in each subscription remain connected to AKS and/or private endpoints: `aks-northcentral`, `flex-functions`, and `vnet-logic-apps-operations`. Production has 44 private endpoints and Test has 25; all listed private endpoint targets exist and their connections are approved. Do not delete these VNets or the active private DNS links as a bulk cleanup.

## Storage accounts: observed traffic

Thirty-day `Transactions` totals, rounded only in the text below. At the time of inventory, every listed account except the extra Test Video Indexer account was declared by the Pulumi program. The Markdown account definition was subsequently removed after the owner confirmed that it is no longer needed. High transaction counts indicate active data-plane use, but this metric does not identify every caller.

| Production account | Transactions | Assessment |
| --- | ---: | --- |
| `aimieconfigprodsuffix001` | 686 | Blob reads; retain until readers are identified and migrated. |
| `aimieserviceobgbxpas4ai6` | 14,404,711 | Active Durable host state. |
| `integritycacheprodsuffix` | 16,348,054 | Active data and Video Indexer dependency. |
| `probonolawportalkc7ebqpb` | 245 | Low volume, but Blob reads and Table queries occurred. A retained portal deployment configuration still names it. Contains `feedback-images` and `staffphotos`; retain pending application/data migration. |
| `dataautomationlavdqzxqu4` | 38,591,276 | Active. Its file share is protected by `vault-mmaqpvf0`; last successful backup was 23 October 2026. |
| `dataingestionsvctq4ih3ga` | 7,882,441 | Active. |
| `dataintegrityextractorrf` | 9,478,869 | Active. |
| `notificationsvcjngq43h5v` | 39,715 | Owner confirmed the account is not needed. Account and dedicated storage endpoints deleted; Web PubSub and telemetry remain. |
| `portalstartertpusarwi` | 4,641,595 | Active queue, Blob, and Table calls, including about 1.28 million queue peeks. Do not infer disuse from the retired App Service. |
| `resourcemanagerl7f5tq5g` | 6,950,567 | Active. |
| `mdhtmlconverterob6rl7ou` | 39,238 | Owner confirmed the account is not needed. Account and dedicated storage endpoints deleted. |

| Test account | Transactions | Assessment |
| --- | ---: | --- |
| `aimieconfigtestsuffix001` | 1,126 | Current configuration blobs and Test service reader moved; retain pending any other writers and retention. |
| `aimieserviceclxo2mycjfpl` | 14,184,787 | Active. |
| `integritycachetestsuffix` | 39,456,086 | Active; Video Indexer is bound here. |
| `probonolawportal7n5eya35` | 3,695 | Containers/tables and Test backend moved. Retain until stored absolute blob URLs are addressed. |
| `dataautomationlasnn5vo5p` | 33,274,735 | Active. |
| `videoindexertestsuffixrv` | 60 | Service-property probes only; retirement candidate above. |

## Monitoring and other retained dependencies

Log Analytics `Usage` shows ingestion in all seven Test workspaces and nine of ten Production workspaces over the same 30 days. The largest are Test AKS (54.92 GB), Test Data Automation (17.63 GB), Production Data Automation (44.37 GB), and the AIMIE workspaces (about 4 GB each). The portal workspaces ingested 3.55 GB in Test and 1.76 GB in Production. These are not unused workspaces.

Production `probono-law-aks-prod-law` recorded **0 GB**, but the live AKS `omsagent` add-on is enabled and explicitly targets that workspace. Investigate whether Container Insights is expected and functioning before disabling the add-on or retiring the workspace. The Azure Monitor/Prometheus resources are a separate dependency.

The Production Recovery Services vault `vault-mmaqpvf0` has a healthy protected Azure file share, with a completed backup on 23 October 2026. Retain the vault and Data Automation share. The active Front Door, Static Web App, AKS, public API IP, registry, Key Vaults, private endpoints, Event Hubs, Cosmos DB, Search, Foundry, Video Indexer, and their linked networks were not identified as unused by this review.

## Recommended sequence

Subsequent owner direction consolidates Test Data Automation, integrity-cache, and portal storage into one new North Central US account, and pairs AIMIE Service with AIMIE Config in a separate new North Central US account. See the [migration plan](shared-storage-northcentral-migration.md). Portal containers/tables and AIMIE Config's 24 `agents` blobs must transfer; Data Automation's legacy Functions/Logic App data is explicitly excluded. The program stages both destinations while retaining all five sources until cutover.

1. Export/inspect both Pulumi states and run previews before changing anything, especially resources absent from source but possibly still in state.
2. Retire the confirmed orphan candidates in small groups: empty resource groups, old certificates, stale DNS zones, the Test Video Indexer storage account, and the isolated Production VNet. Check deletion previews and the App Service association on that VNet.
3. Remove empty subnets with their storage/Document Ingress firewall references in one reviewed Pulumi change. Keep the Test Search subnet with its live endpoint.
4. Inventory portal storage readers/writers and stored data before deciding whether either portal account can be retired. Investigate the zero-ingestion Production AKS workspace separately.

These candidates are primarily hygiene items; Azure resource groups, VNets, and subnets have little or no standing charge. Validate storage size, backup retention, and current Azure Cost Analysis before assigning savings figures. Only the owner-confirmed Markdown and notification storage deletions have been implemented so far; the other retirement candidates remain recommendations.
