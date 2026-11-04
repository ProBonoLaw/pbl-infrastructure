# North Central US network consolidation — 28 October 2026

## Reason for the remaining VNets

The Central US `flex-functions` VNet was the former Functions and portal integration network. Both environments had no App Service apps or plans, no subnet IP configurations, and no service association links in this VNet. Pulumi still declared it, its subnets, DNS links, and peerings.

The West Central US `vnet-logic-apps-operations` still carried ten private endpoints per environment. Storage and replacement Video Indexer endpoints had already moved, but these other service endpoints had not. AKS reached their `10.0.*` addresses through peering.

Production also had an isolated Central US `data-ingestion-vnet`. Its only App Service link pointed to the deleted notification plan. Azure's `purgeUnusedVirtualNetworkIntegration` operation released the orphan association, allowing the VNet and its empty resource group to be deleted.

## Target configuration

Each subscription uses `aks-northcentral` in `shared-vnet-aks-northcentral`, with address space `172.28.243.0/24`:

| Subnet | Address range | Use |
| --- | --- | --- |
| `aks` | `172.28.243.0/25` | Existing AKS nodes |
| `private-endpoints` | `172.28.243.128/25` | All 17 application private endpoints |

The 17 endpoints comprise six Blob/Queue/Table connections for the two consolidated storage accounts, one replacement Video Indexer connection, and these ten migrated connections:

| Service | New private endpoint name |
| --- | --- |
| Primary Foundry / Content Understanding | `aks-nc-foundry-pe` |
| Document Intelligence | `aks-nc-document-intelligence-pe` |
| Data Loader Foundry | `aks-nc-data-loader-pe` |
| Document Ingress | `aks-nc-document-ingress-pe` |
| Cosmos DB | `aks-nc-cosmos-pe` |
| AI Search | `aks-nc-search-pe` |
| Event Hubs | `aks-nc-eventhubs-pe` |
| Web PubSub | `aks-nc-webpubsub-pe` |
| Customer Key Vault | `aks-nc-customer-vault-pe` |
| Onboarding Key Vault | `aks-nc-onboarding-vault-pe` |

Private endpoints can connect to services in other Azure regions. The backing service accounts remain in their existing regions; their data, identities, and application hostnames are preserved. Global private DNS zones remain in their existing resource groups, whose regional labels do not represent deployed VNets.

## Execution and verification

Status: completed in Azure for Test and Production.

| Verified final state | Test | Production |
| --- | ---: | ---: |
| VNets (all North Central US) | 1 | 1 |
| Subnets | 2 | 2 |
| Peerings | 0 | 0 |
| Approved North Central US private endpoints | 17 | 17 |
| Private DNS zones / links to AKS VNet | 15 / 15 | 15 / 15 |
| Old private endpoints deleted | 10 | 10 |
| File Operations deployments ready | 12 | 12 |
| AIMIE pods ready on North Central US nodes | 1 | 1 |

All private DNS A records resolve within `172.28.243.0/24`. Both environments passed 15 DNS/TLS address checks and five authenticated read-only checks after their West Central US peerings were removed.

Production applied 69 deletions and one Document Ingress ACL update. Test applied 54 deletions and the same ACL update before Azure returned a conflict for an already queued internal DNS-link deletion. Both affected links and both old VNets were then confirmed absent. A targeted refresh removed two obsolete link entries, and a reviewed retry completed the remaining 12 empty-group/naming-deployment deletions. No application rollback was needed. Final full Pulumi previews report no changes in either environment.

1. Export both Pulumi states and inventory every old endpoint, connection, NIC, DNS group, and network dependency.
2. Create new approved endpoints without changing DNS. Preserve Web PubSub's private connection permissions.
3. Probe all 15 service addresses directly from AKS with TLS certificate/SNI validation, including Event Hubs on port 5671.
4. Move DNS zone groups while old endpoints and peerings remain. Data Loader also receives its missing OpenAI and AI Services DNS bindings.
5. Verify that all 15 names resolve to `172.28.243.*`, establish TLS, and complete authenticated read-only calls to Document Intelligence, three Content Understanding analyzers, and Cosmos DB metadata.
6. Delete old endpoints, refresh their obsolete Pulumi entries, and import all ten replacement endpoints and DNS groups. This also brings the previously unmanaged Search endpoint under Pulumi.
7. Remove old subnet firewall rules, VNet links, peerings, subnets, VNets, and their empty groups through a reviewed Pulumi plan. Preserve Key Vault deletion locks and the North Central US access rules.
8. Recheck service access, workload readiness, live network inventory, and a no-change Pulumi preview.

The obsolete Test `privatelink.files.core.windows.net` zone had one record for retired portal-starter storage and one old VNet link. Its metadata was backed up and the zone/link removed. The valid `privatelink.file.core.windows.net` zone remains. Two stale portal-starter Queue/Table records pointing to `10.0.7.7` and `10.0.7.6` were also backed up and removed.

## Operational tools and records

- `scripts/consolidate-private-endpoints.py`: inventory, stage, DNS cutover, and retirement with a resumable local journal and DNS rollback on cutover failure.
- `scripts/verify-private-endpoint-migration.py`: direct-IP and DNS/TLS probes from an existing AKS pod.
- `scripts/verify-network-runtime.py`: authenticated read-only service checks using active runtime settings in process memory. No credentials are written to journals or output.
- `scripts/audit-consolidated-network.py`: final VNet, subnet, endpoint, DNS, File Operations deployment and AIMIE pod assertions against live Azure/AKS.
- `scripts/adopt-consolidated-endpoints.ps1`: targeted refresh and import after verified retirement. Requires the Pulumi passphrase in the process environment.

Operator-local records use `probonolaw-network-*-20261028.json` under `%TEMP%`. State backups remain operator-local. No temporary migration identities or diagnostic pods are required for this network change.

Graph checks enforce one VNet, two subnets, zero peerings, 17 private endpoints in North Central US, and 15 DNS links to the AKS VNet. They also reject references to either retired VNet while retaining Document Intelligence, Content Understanding, and Video Indexer.

The Web PubSub ARM template now persists the allow list for the retained
`aks-nc-webpubsub-pe` connection in each environment. Its Azure-generated connection
suffixes were verified with read-only ARM queries on 29 October. If that endpoint
is replaced, update the corresponding suffix in
`src/services/aimie-notification/index.ts` after approving the new connection.
The final network audit requires positive, ready and updated replicas in all
twelve File Operations deployments.
