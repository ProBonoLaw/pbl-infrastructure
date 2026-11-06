# Daat-Phoenix hosted Test retirement — November 6, 2026

## Deployment policy

Daat-Phoenix is consolidating ProBonoLaw into its existing Production stack,
which serves as the demo/production site. The former Test subscription has been renamed
Daat(Math); the running Test application has been removed. No Test application data is being migrated or backed up.

The reusable infrastructure retains `Pulumi.test.yaml`, the Test resource
definitions, and verification of both environments. Hosted Test deployment is
optional: the repository variables `AZURE_DEPLOY_ENABLED` and
`TEST_ENVIRONMENT_ENABLED` must both be `true` to run its Azure jobs.
Daat-Phoenix keeps the latter `false`. Ordinary builds and graph checks remain
enabled without a deployed Test stack.

The Test stack also sets `environmentEnabled=false`, preventing an accidental
local `pulumi up`. Operators creating their own Test stack must explicitly enable
it after configuring a dedicated subscription. Offline graph checks enable their
mock stack independently.

Production public DNS no longer includes Test records by default. Operators
with a separate Test stack can explicitly set `manageTestPublicDns=true` and
adapt the four Test records to their installation. This does not create a Test
stack or alter Production application routing.

## Execution

- Inventoried the subscription, deployment identities, GitHub environments,
  workflow definitions, and both Pulumi checkpoints. Checkpoints are operational
  metadata; no application data was copied.
- Checked Production's Kubernetes configuration and Pulumi state for Test
  references. Production uses its own registry, vaults, identities, and stores.
- Disabled hosted Test deployment workflows and removed Test GitHub
  environments and credentials from the public and private application copies.
- Added opt-in gates to application Test publishing and deployment jobs while
  preserving ordinary validation. AIMIE Service now publishes validated images
  directly to the Production registry, removing its
  dependency on promotion from the Test registry. Optional Test publishing
  remains separately gated.
- Submitted retirement of the Test AKS cluster and application resource groups,
  including resources not owned by Pulumi. Removed the two Test vault deletion
  locks within the authorized retirement scope. AKS, storage, Cosmos DB, AI
  services, registries, vaults, monitoring, and networking are removed. Front Door
  has removed its endpoint and is finishing deletion of the empty profile.
- Production Document Intelligence, three Content Understanding analyzers, and
  Cosmos DB metadata requests returned HTTP 200 during retirement.
- Removed all four Test public DNS records, the obsolete deployment-state grant,
  three Test custom roles, and the Test Pulumi state container. Production state
  remains in its original container.
- Ten application workflow pull requests have passed checks and merged. The
  public infrastructure and Billing changes await the independent review
  required by those repositories. The private infrastructure changes have their
  own verification and merge process.

## Azure retention

The old Recovery Services vault enforces AlwaysOn soft deletion with a 14-day
retention period. Two legacy Azure Files protection items are now stopped and
scheduled for deletion. One was already awaiting expiry; stopping the other on
November 6 starts its required retention period, ending around November 20.
The vault cannot be removed until Azure releases those items and their storage
container registrations. Deleted purge-protected Key Vaults can also remain in
Azure's recoverable inventory until their retention expires.

These retained recovery objects are separate from the running application.
They must be accounted for when checking that the subscription is completely
clear; deleting a Pulumi stack alone does not remove them. Final retirement
status should be verified against Azure, including resource groups, remaining
resources, and obsolete deployment permissions.
