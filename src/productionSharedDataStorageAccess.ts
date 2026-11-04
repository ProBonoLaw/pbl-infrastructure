import { managedidentity, resources, storage } from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";
import { assign, roleIds } from "./core/iam";

// Current application data only. No legacy Functions containers or file shares.
const operationContainers = [
  "account-operations-checkpoints",
  "account-operations-failed-events",
  "aimie-operations-checkpoints",
  "aimie-operations-failed-events",
  "aimie-operations-results",
  "email-operations-checkpoints",
  "email-operations-failed-events",
  "file-operations-checkpoints",
  "file-operations-evidence-checkpoints",
  "file-operations-evidence-event-checkpoints",
  "file-operations-failed-events",
  "file-operations-sync-state",
];
const portalContainers = ["feedback-images", "staffphotos"];
const portalTables = [
  "betatester",
  "federaljurisdictions",
  "newsletter",
  "staff",
  "statejurisdictions",
  "tribaljurisdictions",
];

export function configureProductionSharedDataStorageAccess(
  account: storage.StorageAccount,
  group: resources.ResourceGroup,
  subscriptionId: pulumi.Input<string>,
  environmentName = "Production",
) {
  const test = environmentName === "Test";
  const runtimeEnvironment = test ? "test" : "prod";
  const containers = Object.fromEntries(
    [...operationContainers, ...(test ? [] : portalContainers)].map((name) => [
      name,
      new storage.BlobContainer(`shared-data-container-${name}`, {
        resourceGroupName: group.name,
        accountName: account.name,
        containerName: name,
        publicAccess: "None",
      }),
    ]),
  );
  const tables = Object.fromEntries(
    [...(test ? [] : portalTables), "IngestionProgress"].map((name) => [
      name,
      new storage.Table(`shared-data-table-${name}`, {
        resourceGroupName: group.name,
        accountName: account.name,
        tableName: name,
      }),
    ]),
  );
  const identity = (name: string) =>
    managedidentity.getUserAssignedIdentityOutput({
      resourceGroupName: test
        ? "probono-law-aks-prototype"
        : "probono-law-aks-production",
      resourceName: name.replace("-prod-", `-${runtimeEnvironment}-`),
    }).principalId;
  const grant = (
    name: string,
    scope: pulumi.Input<string>,
    principalId: pulumi.Input<string>,
    roleId: string,
  ) =>
    assign(
      `shared-data-access-${name}`,
      scope,
      principalId,
      pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
    );

  // Preserve the existing Operations container boundaries when staging access.
  const writers = [
    [
      "account-operations-prod-workload",
      "account",
      ["account-operations-checkpoints", "account-operations-failed-events"],
    ],
    [
      "account-operations-email-prod-workload",
      "account-email",
      ["account-operations-checkpoints", "account-operations-failed-events"],
    ],
    [
      "aimie-operations-prod-workload",
      "aimie",
      [
        "aimie-operations-checkpoints",
        "aimie-operations-failed-events",
        "aimie-operations-results",
      ],
    ],
    [
      "email-operations-prod-workload",
      "email",
      ["email-operations-checkpoints", "email-operations-failed-events"],
    ],
  ] as const;
  for (const [name, label, names] of writers) {
    const principal = identity(name);
    for (const container of names) {
      const purpose = container.replace(
        /^(account|aimie|email)-operations-/,
        "",
      );
      grant(
        `${label}-${purpose}`,
        containers[container].id,
        principal,
        roleIds.blobContributor,
      );
    }
    if (label === "email") {
      grant(
        "email-results-reader",
        containers["aimie-operations-results"].id,
        principal,
        roleIds.blobReader,
      );
    }
  }

  // Test portal resources and grants were adopted separately during its cutover.
  if (!test) {
    const portal = identity("probonolaw-ui-runtime-prod");
    for (const name of portalContainers) {
      grant(
        `portal-${name}`,
        containers[name].id,
        portal,
        roleIds.blobContributor,
      );
    }
    for (const name of portalTables) {
      grant(
        `portal-${name}`,
        tables[name].id,
        portal,
        roleIds.tableContributor,
      );
    }
  }

  // File Operations creates evidence containers, queues, and ingestion state.
  const files = identity("file-operations-prod-workload");
  for (const [service, roleId] of [
    ["blob", roleIds.blobContributor],
    ["queue", roleIds.queueContributor],
    ["table", roleIds.tableContributor],
  ]) {
    grant(`files-${service}`, account.id, files, roleId);
  }
}
