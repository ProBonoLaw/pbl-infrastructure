import * as pulumi from "@pulumi/pulumi";
import { managedidentity, storage } from "@pulumi/azure-native";
import { assign, roleIds } from "./core/iam";

// Adopt the Test grants established during the 2026-10-24 migration.
// Container/table scopes keep the portal out of other shared application data.
const portalGrants = [
  [
    "feedback-images",
    "blobServices/default/containers",
    roleIds.blobContributor,
    "00000000-0000-4000-8000-000000000027",
  ],
  [
    "staffphotos",
    "blobServices/default/containers",
    roleIds.blobContributor,
    "00000000-0000-4000-8000-000000000028",
  ],
  [
    "betatester",
    "tableServices/default/tables",
    roleIds.tableContributor,
    "00000000-0000-4000-8000-000000000029",
  ],
  [
    "federaljurisdictions",
    "tableServices/default/tables",
    roleIds.tableContributor,
    "00000000-0000-4000-8000-00000000002a",
  ],
  [
    "newsletter",
    "tableServices/default/tables",
    roleIds.tableContributor,
    "00000000-0000-4000-8000-00000000002b",
  ],
  [
    "staff",
    "tableServices/default/tables",
    roleIds.tableContributor,
    "00000000-0000-4000-8000-00000000002c",
  ],
  [
    "statejurisdictions",
    "tableServices/default/tables",
    roleIds.tableContributor,
    "00000000-0000-4000-8000-00000000002d",
  ],
  [
    "tribaljurisdictions",
    "tableServices/default/tables",
    roleIds.tableContributor,
    "00000000-0000-4000-8000-00000000002e",
  ],
] as const;

export function configureSharedStorageApplicationAccess(
  environmentName: string,
  subscriptionId: pulumi.Input<string>,
  dataAccount: storage.StorageAccount | undefined,
  aimieAccount: storage.StorageAccount,
  aimieAgents: storage.BlobContainer,
) {
  if (environmentName !== "Test" && environmentName !== "Production") return;
  const identity = managedidentity.getUserAssignedIdentityOutput({
    resourceGroupName:
      environmentName === "Test"
        ? "probono-law-aks-prototype"
        : "probono-law-aks-production",
    resourceName:
      environmentName === "Test"
        ? "aimie-service-test-workload"
        : "aimie-service-workload-prod",
  });
  // The Functions/Durable host creates containers, queues, and tables. These
  // data roles support that runtime without granting account management access.
  for (const [name, roleId] of [
    ["blob-owner", roleIds.blobOwner],
    ["queue-contributor", roleIds.queueContributor],
    ["table-contributor", roleIds.tableContributor],
  ]) {
    assign(
      `shared-storage-aimie-${name}`,
      aimieAccount.id,
      identity.principalId,
      pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
    );
  }
  // Keep the explicitly requested configuration-container ownership visible
  // at this scope, in addition to the host's account-level data permissions.
  assign(
    "shared-storage-aimie-agents-owner",
    aimieAgents.id,
    identity.principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.blobOwner}`,
  );
  if (environmentName !== "Test") return;
  const subscriptionScope = pulumi.output(subscriptionId).apply((value) => {
    if (value !== "/subscriptions/00000000-0000-4000-8000-000000000003") {
      throw new Error(
        "Shared storage grant imports require the Test subscription",
      );
    }
    return value;
  });
  const storageScope =
    "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/shared-storage-northcentral/providers/Microsoft.Storage/storageAccounts";
  if (dataAccount)
    for (const [name, service, roleId, assignmentId] of portalGrants) {
      assign(
        `shared-storage-portal-${name}-contributor`,
        pulumi.interpolate`${dataAccount.id}/${service}/${name}`,
        "00000000-0000-4000-8000-000000000013",
        pulumi.interpolate`${subscriptionScope}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
        "ServicePrincipal",
        `${storageScope}/probonolawdatatestsuffix/${service}/${name}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}`,
      );
    }
}
