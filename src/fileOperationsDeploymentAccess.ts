import { managedidentity } from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";
import { assign, roleIds } from "./core/iam";

// Adopt the resource-scoped CI Reader grants, including the consolidated input
// storage grant added after migration. Preserve their existing Azure IDs.
const readerAssignments = [
  {
    name: "workload-identity",
    resource:
      "probono-law-aks-production/providers/Microsoft.ManagedIdentity/userAssignedIdentities/file-operations-prod-workload",
    assignmentId: "00000000-0000-4000-8000-000000000015",
  },
  {
    name: "cosmos",
    resource:
      "shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/db-law-sls-prodsuffix001",
    assignmentId: "00000000-0000-4000-8000-000000000016",
  },
  {
    name: "shared-data-storage",
    resource:
      "shared-storage-northcentral/providers/Microsoft.Storage/storageAccounts/probonolawdataprodsuffix",
    assignmentId: "00000000-0000-4000-8000-000000000009",
  },
  {
    name: "search",
    resource:
      "shared-dbs/providers/Microsoft.Search/searchServices/aimie-search-74239",
    assignmentId: "00000000-0000-4000-8000-000000000017",
  },
] as const;

export function configureFileOperationsDeploymentAccess(
  environmentName: string,
) {
  if (environmentName !== "Production") return [];
  const subscriptionId = new pulumi.Config("azure-native").require(
    "subscriptionId",
  );
  if (subscriptionId !== "00000000-0000-4000-8000-000000000002") {
    throw new Error(
      "File Operations Reader imports require the Production subscription",
    );
  }
  const subscriptionScope = `/subscriptions/${subscriptionId}`;
  // Identity lifecycle and federation stay with the application's bootstrap.
  // Resolve its principal instead of treating a client ID as an Azure object ID.
  const ciIdentity = managedidentity.getUserAssignedIdentityOutput({
    resourceGroupName: "probono-law-aks-production",
    resourceName: "file-operations-ci-prod",
  });
  return readerAssignments.map(({ name, resource, assignmentId }) => {
    const scope = `${subscriptionScope}/resourceGroups/${resource}`;
    return assign(
      `file-operations-production-ci-${name}-reader`,
      scope,
      ciIdentity.principalId,
      `${subscriptionScope}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.reader}`,
      "ServicePrincipal",
      `${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}`,
    );
  });
}
