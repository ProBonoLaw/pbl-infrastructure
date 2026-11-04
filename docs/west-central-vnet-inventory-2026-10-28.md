# West Central US VNet inventory — 28 October 2026

This is the historical inventory before consolidation. See the [network consolidation execution record](network-consolidation-2026-10-28.md) for the later migration and current status.

Both environments retain `vnet-logic-apps-operations` in
`shared-vnet-data-ingestion-logic-apps`, West Central US, with address space
`10.0.0.0/16`. It provides private service endpoints reached from North Central US
AKS through VNet peering. Moving the applications to AKS did not relocate these
endpoints.

## Live inventory

Azure reports **10 approved private endpoints in this VNet per environment**.
All 10 attached network interfaces belong to private endpoints. Subnet inventory
shows no service-association or resource-navigation links. Storage and replacement
Video Indexer endpoints are already in the North Central US AKS VNet.

| Service | Test target | Production target |
| --- | --- | --- |
| Document Intelligence | `cog-svc-testsuffix001` | `cog-svc-prodsuffix001` |
| Primary Foundry / Content Understanding | `aimie3-testsuffix001` | `aimie3-prodsuffix001` |
| Data loader Foundry | `data-loader-testsuffix001` | `data-loader-prodsuffix001` |
| Separate Document Ingress cognitive account | `aimienotificationpubsubmby27523` | `aimienotificationpubsubrfruq2an` |
| Cosmos DB | `db-law-sls-testsuffix001` | `db-law-sls-prodsuffix001` |
| Azure AI Search | `aimie-search-59364` | `aimie-search-74239` |
| Event Hubs | `probonolawsharedhetestsuffix` | `probonolawsharedheprodsuffix` |
| Notification Web PubSub | `aimienotificationpubsub2hizt5uy` | `aimienotificationpubsubjngq43h5` |
| Customer-account Key Vault | `customeraccountbdli4j5t` | `customeraccountxrh4fcqw` |
| Onboarding Key Vault | `onboardingdpl4ki7wuz7` | `onboardingdplpnvecvu5` |

The AI Search endpoints are live resources outside the current Pulumi private
endpoint definitions. Include them explicitly in any migration inventory.

Both VNets have connected peerings to `aks-northcentral` and `flex-functions`.
The North Central US VNet is already linked to the shared private DNS zones.
Those DNS zones are global resources; their location does not require keeping
the West Central US VNet.

## Confirmed AKS dependency

DNS resolution inside each environment's AKS cluster returns West Central US
VNet addresses for Document Intelligence, primary Foundry and Cosmos DB. Test
resolved these to `10.0.29.4`, `10.0.27.6` and `10.0.14.6`, respectively.
Document Intelligence private API reads passed in both environments. Production
Content Understanding subsequently passed synthetic document and audio processing
through the deployed Data Integrity API.

Consequently, removing this VNet or its AKS peering now would interrupt active
services. An approved endpoint connection alone does not prove business usage for
every other listed service; the data-loader and separate Document Ingress accounts
should be checked against their consumers before deciding to migrate or retire them.

## Route to one application VNet

1. Confirm which of the 10 service connections are still required, including the
   live Search endpoints and the Key Vault certificate consumers.
2. Create replacement private endpoints in `aks-northcentral/private-endpoints`.
   The backing Azure services can remain in their supported service regions.
3. Switch the relevant private DNS records and verify service access from AKS,
   including Data Integrity, ingestion, Search, Event Hubs, Web PubSub and Key Vault.
4. Remove the old endpoints and obsolete subnet references in service firewalls.
5. Remove the West Central US peerings and VNet after the final dependency check.

This inventory is read-only. No endpoint, peering or VNet was removed during
the inspection.
