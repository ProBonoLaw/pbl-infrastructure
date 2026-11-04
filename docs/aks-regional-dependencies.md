# Deferred regional moves for AKS dependencies

The replacement Test AKS cluster and the Production AKS cluster are in North Central US. Their peered VNets and private DNS links already reach the retained Event Hubs and storage endpoints. Keep these stateful services in place through the AKS workload cutovers. Reassess their regions after the Test and Production workloads have stabilized.

| Dependency | Current region | Current role and migration concern |
| --- | --- | --- |
| Test `probonolawsharedhetestsuffix` and Production `probonolawsharedheprodsuffix` Event Hubs namespaces | West Central US | Shared event streams for the portal, services, . A new namespace needs its active hubs, partitions, retention, consumer groups, access policies, private endpoint, DNS, and client settings. Coordinate producers, consumers, retained events, and checkpoints. The `state-events` hub was designated for retirement but still exists; verify its traffic and consumers before including it in a replacement. |
| Test `aimieconfigtestsuffix001` (`aimie-config`) | Central US | RA-GRS blob account containing the `agents` container. Identify every reader and writer, copy blobs, then update endpoints, access grants, and private DNS. Confirm the desired replication pairing in the destination region. |
| Test `integritycachetestsuffix` (`integrity-cache`) | Central US | RA-GRS account with `exhibits`, `input`, and `results`. AKS Data Integrity and Data Ingestion use it, and the East US Video Indexer account is bound to it through `storageServices.resourceId` and a Blob Data Contributor grant. Preserve data and verify the Video Indexer binding before any cutover. |
| Test `aimieserviceclxo2mycjfpl` (`aimie-service`) | Central US | LRS host storage for AIMIE's AKS Durable Functions container through `AzureWebJobsStorage`, with four private endpoints. Its blob, queue, and table state may contain in-flight orchestration work. Plan a controlled drain and supported state transition before changing the host account. |

The corresponding Production storage accounts also have clients outside AKS. Inventory their live clients before choosing destination regions. Account and namespace regions cannot be changed in place; provision new resources alongside the existing ones, migrate state and clients, and retire the originals only after verification. Do not change the `location` of a live Pulumi storage account or Event Hubs namespace as a shortcut.

## Priority and cost check

1. Complete AKS application cutovers and identify the final region of every producer and consumer. Leave the existing storage and Event Hubs available during that work.
2. Evaluate Event Hubs in North Central US first, once its clients have moved. The existing namespaces are the West Central US outliers. For September 7 through October 7, 2026 UTC, Azure namespace metrics show Test at 1,196,703 incoming bytes and 2,791,800 outgoing bytes (2,820 and 6,037 messages), and Production at 26,895 incoming bytes and 29,304 outgoing bytes (60 messages each way). These aggregate metrics do not identify inter-region traffic or billed transfer. Compare measured latency and networking charges with the cost of a side-by-side namespace migration before scheduling it.
3. Evaluate `aimie-config` after its clients are known, then `integrity-cache` after checking Video Indexer and data movement. Moving RA-GRS accounts changes their replication geography and requires data copy and endpoint changes; a closer AKS region alone is not enough reason to move them.
4. Move the AIMIE Durable host account last, only with a reviewed plan for in-flight instances, task hub state, queues, tables, blobs, private endpoints, and rollback. Keep the old account available until the replacement host has completed real orchestrations.

For each candidate, measure current storage capacity, transaction volume, and actual cross-region transfer in Cost Analysis before estimating savings. A second namespace or account incurs temporary charges during migration. No live resource move or deletion is part of the current AKS cluster rollout.
