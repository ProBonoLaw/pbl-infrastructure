# Cosmos DB migration to North Central US

## Approved target

Convert Test first, validate it, then convert Production. Use Cosmos DB regional
replication in the existing accounts; finish with North Central US as the only
data region, with availability zone redundancy. The conversion from serverless
to provisioned throughput is irreversible. This is not an account replacement.

| Environment | Subscription | Existing account name and endpoint prefix |
| --- | --- | --- |
| Test | `00000000-0000-4000-8000-000000000003` | `db-law-sls-testsuffix001` |
| Production | `00000000-0000-4000-8000-000000000002` | `db-law-sls-prodsuffix001` |

Both accounts are in `shared-dbs`. Their names, account endpoints and Pulumi URNs
are retained. The historical `sls` and `serverless-pilot` identifiers must not be
renamed: a new account name would require the separate data migration avoided by
this approach. Azure's immutable ARM home `location` remains `centralus`; the
`locations` collection specifies where the data actually resides.

The `aks-nc-cosmos-pe` private endpoint already uses the North Central US AKS
VNet in both subscriptions. Adding a Cosmos region must also produce a regional
private IP/DNS record, verified from an existing AKS application pod.

## Capacity and cost

Nine existing containers in `db_conversation_history` are preserved in each
environment. Test's `billingRuns` container was created outside Pulumi and remains
application-owned; its throughput is included in this change.

| Containers | Autoscale maximum RU/s per container | Idle RU/s per container |
| --- | ---: | ---: |
| `messages2` | 5,000 | 500 |
| `notices` | 2,000 | 200 |
| `accounts`, `accountUsage`, `aimieStats`, `requests`, `clientFeedbackRequests`, `feedback`, `billingRuns` | 1,000 | 100 |

Each account has 14,000 RU/s total configured autoscale maximum and 1,400 RU/s
aggregate idle capacity. Azure retail pricing retrieved on 2026-10-28 is
$0.012 per 100 autoscale RU/s per hour in North Central US. At 730 hours/month:

- One region: approximately **$122.64 per environment / $245.28 combined** idle
  throughput, up to $1,226.40 per environment if all containers sustain their
  ceiling for every hour.
- During replication, the Central US copy also incurs throughput/storage charges.
- These estimates exclude storage, backup, transfer, taxes and discounts. Actual
  autoscale charges depend on the highest scaled throughput in each billing hour.
- Availability zone premiums are waived for autoscale collections.
- Initial conversion allocates **5,000 RU/s per physical partition**. Convert
  containers to autoscale and set the reviewed limits immediately afterward.

The seven-day baseline shows low aggregate RU consumption; provisioned capacity
costs more than the previous pay-per-request serverless mode. The user selected
North Central US only after reviewing the estimated idle costs.

## Procedure and safeguards

1. Capture account/database/container metadata, native SQL RBAC assignments,
   encrypted Pulumi state and a read-only data baseline from AKS. The data report
   contains counts, partition counts and SHA-256 digests, never document bodies.
2. `migrate-cosmos-region.py <env> convert`: PATCH only
   `properties.capacityMode = Provisioned` using API `2026-04-01-preview` and wait
   for the transition to complete. No region changes during conversion. Set
   `cosmosProvisioned: true` after completion so the source records the new mode.
3. `autoscale`: migrate each dedicated container's throughput to autoscale,
   apply the limits above and verify the service-reported values.
4. `replicate`: add zone-redundant North Central US as priority 1. Keep Central US
   as writer while Cosmos copies and synchronizes all existing data.
5. Verify regional private DNS, data counts and hashes in North Central US against
   the source. Concurrent legitimate application writes must be investigated and
   reconciled with a fresh source comparison before proceeding.
6. `promote`: use the supported `failoverPriorityChange` operation to make North
   Central US priority 0. Check global endpoint access, runtime health and data.
7. `retire-central`: remove Central US only after a matching North Central US
   report. Run the final global/region and runtime checks.
8. Set the environment's `cosmosNorthCentral` Pulumi config to `true`, refresh the
   account, review a saved plan with no data-resource replacement/deletion, and
   apply the dedicated autoscale ARM deployments. Finish with a no-change preview.
9. Repeat for Production only after Test passes.

The migration script journals every request and completion flag in operator-local
files. It does not delete accounts, databases, containers or documents. Application
credentials and SQL RBAC remain unchanged. Once North Central US is the sole data
region, SDK discovery routes both reads and writes there through the existing
global endpoint; no application connection-string change is required.

Azure region changes can outlast the initial ARM polling window. A polling timeout
does not cancel the service operation. Use `inspect`, then `resume` with the same
journal to wait for and validate the existing request without resubmitting it.

The final Pulumi config is a record of a completed staged migration. **Do not set
it early and attempt to perform conversion, replication and failover in one PUT.**
The account, database and managed containers are protected against replacement or
deletion in Pulumi. Autoscale settings use incremental ARM deployments because
this Azure Native version does not expose standalone Cosmos throughput settings.
Pulumi previews compare those deployment templates. The live audit script reads
the actual child throughput settings and detects manual changes to their limits.

## Execution status

Test conversion completed at 2026-10-28 18:39 UTC. All nine containers now use
the reviewed autoscale limits. The North Central US replica matched all baseline
counts and hashes, and North Central US is now the only region. The final Test
audit passed, including unchanged schemas, security settings and five native SQL
role assignments. Its reviewed Pulumi plan created only nine autoscale configuration
deployments with 381 resources unchanged, followed by a no-change preview (390
resources including the stack). Production conversion, autoscale configuration,
replication, data verification and Central US removal are also complete. Its final
live audit passed, including unchanged schemas, security settings and six native
SQL role assignments. Both accounts have North Central US as their sole data
region, with availability zone redundancy.

Production's reviewed Pulumi plan created only nine autoscale configuration
deployments with 429 resources unchanged. Its final full preview reports no
changes (438 resources including the stack). Both environments are reconciled.

Baseline inventory and full data digests were captured before conversion:

- Test: 181,819 documents across nine containers, one physical partition each.
- Production: 67,502 documents across nine containers, one physical partition each.
- All 50 Test and 49 Production deployments were ready before migration.
- Test AKS workload identity queries remained successful during conversion.
- Test hashes and counts matched exactly in North Central US, including all
  172,895 conversation documents in `messages2`.
- After Test failover, workload identity queries still succeeded and all 50
  deployments remained ready.
- Production's 67,502 document counts and hashes also matched exactly. Its first
  regional probe ran while the account operation was still finishing and returned
  403; retrying after full completion succeeded. Wait until the account's
  provisioning state is `Succeeded` before verification.
- After Production failover, workload identity queries succeeded and all 49
  deployments remained ready.
- Final private DNS records in both environments contain only the existing global
  endpoint and the North Central US regional endpoint. Production's DNS cleanup
  completed shortly after the account update; the final audit passed after that
  propagation completed.

Initial 30-sample point reads from AKS to the Central US regional endpoint had
median latency of 29.38 ms in Test and 30.38 ms in Production. These small samples
are diagnostic comparisons, not a guarantee for broader application workloads.
After Test failover, the North Central US regional median was 2.09 ms (p95 3.04 ms)
and the unchanged global endpoint median was 1.98 ms (p95 17.25 ms).
Production's regional median changed from 30.38 ms to 1.98 ms (p95 17.56 ms).
Its global endpoint median changed from 32.26 ms before conversion to 9.58 ms
after failover (p95 10.84 ms).

TypeScript compilation and both target resource graphs pass: 389 Test resources
across 50 types and 437 Production resources across 54 types. Three migration
guard tests cover cross-environment baseline rejection, the exact capacity-only
conversion request, and rejection of region removal when data hashes differ.
The exported states confirm deletion/replacement protection on the account,
database and Pulumi-managed containers: 10 resources in Test and 11 in Production.
The application-created Test `billingRuns` container remains outside Pulumi's
container ownership.

## References

- [Change capacity mode](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-change-capacity-mode)
- [Autoscale throughput](https://learn.microsoft.com/en-us/azure/cosmos-db/provision-throughput-autoscale)
- [Cosmos reliability and availability zones](https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db-nosql)
- [Capacity mode ARM schema](https://github.com/Azure/azure-rest-api-specs/blob/main/specification/cosmos-db/resource-manager/Microsoft.DocumentDB/DocumentDB/preview/2026-04-01-preview/openapi.json)
