# Pro Bono Law infrastructure

This repository defines the Test and Production Azure environments with Pulumi in TypeScript and the Azure Native provider. Each stack stores its state in a separate Azure Blob container.

## Using this repository

This is the infrastructure code that runs [Pro Bono Law](https://probono-law.com), published as a reference for how an Azure-hosted legal-aid platform can be described with Pulumi. It is Azure-specific and tied to ProBonoLaw's own environment: it imports existing resources by ID and refers to named resource groups, vaults, and accounts.

Subscription IDs, the tenant ID, principal and role-assignment IDs, operator IP addresses, and unique resource-name suffixes in this repository are **placeholders** (for example `00000000-0000-4000-8000-000000000002`, addresses in `203.0.113.0/24`, and the suffixes `testsuffix001` and `prodsuffix001`), so a stack will not deploy unchanged. To adapt it, copy [deployment-values.example.json](deployment-values.example.json) to `deployment-values.json` (gitignored), fill in your own values, and run `node scripts/apply-deployment-values.js`. Run it with `--list` to see every placeholder and where it is used, and with `--reverse` to turn real values back into placeholders before committing. You will also need to remove or rework the `import` options that adopt ProBonoLaw's existing resources.

### Deploying from a private copy

ProBonoLaw deploys from a private repository that tracks this one. It is not a GitHub fork (forks of public repositories stay public). It is a separate private repository with this repository added as `upstream`:

```powershell
git remote add upstream https://github.com/probonolaw/pbl-infrastructure.git
git fetch upstream
git merge upstream/main
```

The private copy adds one file, `deployment-values.json` (committed with `git add -f` because it is gitignored here). The Test and Production workflows run `scripts/apply-deployment-values.js` when that file exists, so the real values exist only in the runner's working tree and the shared code merges without conflicts. Change shared code only in this repository. Keep the private copy's own commits to `deployment-values.json`, GitHub Environment settings, and federated credentials, whose subjects must name the private repository (`repo:<org>/<private-repo>:environment:<name>`).

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute and [SECURITY.md](SECURITY.md) to report a vulnerability. The code is licensed under [Apache-2.0](LICENSE).

## Install and verify

```powershell
npm ci
npm run verify
```

`npm run verify` compiles TypeScript and registers the Pulumi program with mocks. It checks the resource graph without a Pulumi stack, backend, or Azure credentials. Live previews and updates require a selected stack, backend access, and Azure credentials.

## GitHub Actions

The Test workflow verifies and previews same-repository pull requests. Changes pushed to `main` run verification and preview, then apply the Test stack with `pulumi up` if both pass. Manual Test runs default to preview and can select `up`. The Production workflow runs manually, defaults to preview, and can select `refresh` or `up`; `target_resources` can limit both the preview and update to specified Pulumi URNs. Production updates also require successful verification and preview in the same run. The preview is a failure gate; a manually selected `up` proceeds as soon as it passes unless GitHub Environment reviewers pause the deploy job. A manually selected non-`main` branch can access either stack only when `allow_non_main` is explicitly enabled. Both workflows use GitHub OIDC with the `deployment-manager-test` and `deployment-manager-prod` user-assigned identities, and store Pulumi state in the `test` and `prod` containers in the `pbldeployments` storage account.

The Test workflow runs its `Build and test infrastructure` job on every pull request, including documentation-only changes and forks. The `main` branch requires that check to pass before a pull request can merge. The job compiles TypeScript and verifies both Test and Production resource graphs; its Azure preview job runs only for same-repository pull requests.

After a successful Test `pulumi up`, the same workflow applies the public portal API ingress controller and cert-manager Issuer/Certificate through AKS Run Command. cert-manager renews the certificate in the Test cluster. The matching GoDaddy A record must point at the Test API public IP before the certificate can become Ready. Production bootstrap remains an explicit rollout step.

Configure GitHub Environments named `test` and `production`, each with `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` variables and a `PULUMI_CONFIG_PASSPHRASE` secret matching that stack's state. The federated credential subjects are `repo:<org>/<repo>:environment:test` and `repo:<org>/<repo>:environment:production` for whichever repository runs the workflows. Add required reviewers to the Production environment if Production workflow runs should require approval.

The Azure preview and update jobs run only when the repository variable `AZURE_DEPLOY_ENABLED` is `true`. Leave it unset in a public copy so the workflows run just the build and verification; set it in the repository that actually deploys.

Foundry account names are configurable. Set the optional GitHub Environment variables `FOUNDRY_PRIMARY_NAME` (default `aimie3-<suffix>`) and `FOUNDRY_DATA_LOADER_NAME` (default `data-loader-<suffix>`), or the Pulumi config keys `primaryFoundryName` and `dataLoaderFoundryName`. Names must be 2-64 letters, digits, or hyphens and globally unique, because each is also the account's custom subdomain. Azure cannot rename an existing account, so changing a name on a deployed stack replaces the account and its projects and model deployments. Leave the variables unset to keep the defaults.

The state storage account is in resource group `Deployment`, subscription `00000000-0000-4000-8000-000000000004`. Each GitHub identity needs `Storage Blob Data Contributor` on its state container in that subscription and the required deployment permissions in its target subscription. The GitHub runner must be able to reach the storage account endpoint.

## Service layout

The Test and Production operations run in AKS. This Pulumi program manages the clusters, registries, identities, monitoring, networking, storage, Cosmos DB, Foundry (including Content Understanding), Document Intelligence, Event Hubs, Key Vaults, Video Indexer, Document Ingress, Web PubSub, Static Web Apps, and Front Door. Both environments have retired their legacy portal Web Apps and use Static Web Apps with Front Door; both stack files set `keepLegacyPortalWebApp: false`.

Service modules under src/services retain the resource groups, data stores, telemetry, private endpoints, and access required by AKS. Root index.ts invokes these modules in dependency order. AKS workload manifests and application settings are owned by their operation repositories. This program does not create Azure Function Apps, Logic Apps, or their plans.

Each stack defines one application VNet, `aks-northcentral`, in North Central US. AIMIE Service and File Operations run on AKS nodes in its `aks` subnet. All 17 application private endpoints use its `private-endpoints` subnet, including storage, Document Intelligence, Content Understanding, Video Indexer, Cosmos DB, Search, Event Hubs, Web PubSub and Key Vaults.

The former Central US Functions/portal network and West Central US Logic Apps network definitions, subnets, peerings and DNS links have been removed. Global private DNS zones retain their existing resource groups and link to the North Central US VNet. Legacy names on some DNS resources and Pulumi logical resources do not indicate a separate VNet. See the [network consolidation record](docs/network-consolidation-2026-10-28.md) for the Azure execution, endpoint inventory and verification.

### Data Integrity AI dependencies

Data Integrity uses Document Intelligence, Video Indexer and Content Understanding.
Document Intelligence is provided by the existing multi-service `CognitiveServices`
accounts in `data-loader-foundry`; it does not have a separately named Document
Intelligence resource. The deployed `DI_ENDPOINT` settings point to these accounts.

| Service | Test account | Production account |
| --- | --- | --- |
| Document Intelligence | `cog-svc-testsuffix001` | `cog-svc-prodsuffix001` |
| Video Indexer | `video-indexer-v2-testsuffix001` | `video-indexer-v2-prodsuffix001` |
| Content Understanding / primary Foundry | `aimie3-testsuffix001` | `aimie3-prodsuffix001` |

All three resource types remain in the infrastructure. See the
[dependency verification](docs/data-integrity-ai-dependencies-2026-10-28.md) for
their Pulumi definitions, private endpoints and current runtime routing.

## Local stack commands

Authenticate to Azure, set the subscription, and connect to the matching Blob container:

```powershell
az login
az account set --subscription <subscription-id>
$env:AZURE_STORAGE_ACCOUNT = "pbldeployments"
pulumi login "azblob://<container-name>"
pulumi stack select <test-or-prod>
pulumi preview --stack <test-or-prod> --diff
```

Use `test` with the Test subscription and `azblob://test`; use `prod` with the Production subscription and `azblob://prod`. Set the stack's passphrase in `PULUMI_CONFIG_PASSPHRASE` when prompted or when running noninteractive commands. Review a standalone preview before selecting a manual GitHub `up` or running a local `pulumi up`. Test updates on `main` run automatically after verification and preview.

## Environment notes

Test and Production use separate subscriptions and Pulumi stacks. Both have an AKS cluster in North Central US. Production uses a separate container registry and secrets vault. The Production Azure Monitor workspace for managed Prometheus is in Central US because that workspace resource is unavailable in North Central US.

The 27 October retirement removed all 15 identified legacy storage accounts after migration and verification, including both integrity-cache accounts. Data Automation's legacy Azure Files backup items are retired and remain subject to Azure Backup's mandatory 14-day soft-delete period. Storage and all other application private endpoints use the North Central US AKS VNet; the subsequent network consolidation is recorded above. Application Insights components and Log Analytics workspaces remain available to workloads. The custom Video Indexer token role and both AKS workload grants target the replacement accounts. See the [execution record](docs/storage-retirement-execution-2026-10-27.md).

The Production Markdown storage account `mdhtmlconverterob6rl7ou`, its Blob/Queue/Table private endpoints, and their DNS zone groups were deleted on 24 October 2026. The `markdown-html-converter` resource group, Application Insights, and Log Analytics workspace remain for telemetry; Test already had no separate Markdown storage account.

The Production notification storage account `notificationsvcjngq43h5v` and its three storage private endpoints were also deleted on 24 October 2026. Notification Web PubSub and telemetry remain; its private endpoint uses the shared North Central US subnet.

Test sets `stageSharedStorageNorthCentral: true` and retains `probonolawdatatestsuffix` for application data and `aimiedatatestsuffix` for combined AIMIE Service and Config data. Both are in North Central US with Blob, Queue, and Table endpoints in the AKS VNet. Current Data Automation data, integrity-cache data, portal containers/tables and AIMIE history have been migrated. Data Automation's legacy Functions/Logic App data and content shares were excluded.

Production enables both storage staging flags for `aimiedataprodsuffix` and `probonolawdataprodsuffix` in North Central US. All four retained accounts disable shared keys and anonymous Blob access, use a default-deny firewall, and have Blob, Queue, and Table private endpoints. General data accounts retain the trusted Azure services exception used by Video Indexer. Test AIMIE retains its existing operator-IP exception; Production AIMIE disables public network access.

Each environment's AIMIE workload identity receives Storage Blob Data Owner, Storage Queue Data Contributor, and Storage Table Data Contributor at its own AIMIE account scope, plus an explicit Storage Blob Data Owner assignment on its `agents` container. General-data access is managed in `src/productionSharedDataStorageAccess.ts`: portal and Operations grants are scoped to selected containers/tables; File Operations receives Blob, Queue, and Table Data Contributor at account scope. Each replacement Video Indexer identity has Blob Data Contributor on its connected general-data account. Application storage and Video Indexer cutovers are complete in both environments.

The old Production Logic App API connections have been retired. The later network consolidation preserves active service accounts and global private DNS.

The consolidated Event Hubs namespace carries file, account, and AIMIE traffic. The portal routes events to the hubs and the AKS operations consume them. Cosmos DB, Foundry with Content Understanding, Document Intelligence, Document Ingress, Web PubSub, and Video Indexer remain managed by this program. The [Cosmos migration record](docs/cosmos-northcentral-migration-2026-10-28.md) documents the conversion to autoscale and North Central US regional replication, including the preserved account names and approved capacity limits.

## Cosmos DB operator access

The platform operator (`00000000-0000-4000-8000-000000000001`) has the account-scoped custom Cosmos data role `Cosmos Metadata and Query Executor`. In Test, this role includes `Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/read` alongside metadata reads and query execution. The item-read addition is limited to Test and is managed in `src/cosmos.ts`.

## Managed Grafana

The Test stack imports the existing Grafana Editor role assignment for `deployment-manager-test` on `grafana-202691141356-sc`. The Production stack creates `probonolaw-grafana-prod` in the `probono-law-grafana-production` resource group in South Central US, grants `deployment-manager-prod` Grafana Editor and `file-operations-ci-prod` Grafana Editor plus metadata Reader on that resource, and grants the Grafana managed identity Log Analytics Reader on the `aimie-data-automation` workspace that receives Production File Operations telemetry. Production Grafana is protected from accidental deletion. Apply each stack to bring these definitions into Pulumi state; the GitHub workflows can apply updates as described above.

For dashboard deployment from the File Operations repository, set the `aks-production` GitHub environment variables `GRAFANA_NAME=probonolaw-grafana-prod`, `GRAFANA_RESOURCE_GROUP=probono-law-grafana-production`, `GRAFANA_LOG_WORKSPACE_RESOURCE=/subscriptions/00000000-0000-4000-8000-000000000002/resourceGroups/aimie-data-automation/providers/Microsoft.OperationalInsights/workspaces/aimie-data-automationwsvdqzxqu4`, and `AZURE_SUBSCRIPTION_ID=00000000-0000-4000-8000-000000000002` after the Production Grafana resource exists.
