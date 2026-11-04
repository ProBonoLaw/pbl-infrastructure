import * as pulumi from "@pulumi/pulumi";
import { network, resources, storage } from "@pulumi/azure-native";
import { createAksNorthNetwork } from "./aksNorthNetwork";
import { createFoundation } from "./foundation";
import { armUniqueString } from "./naming";
import { createAccount } from "./storage";
import { createStoragePrivateEndpointsForService } from "./storageEndpoints";

/** Stage both destinations; source accounts and client bindings stay until cutover. */
export function createSharedStorageNorthCentral(
  enabled: boolean,
  environmentName: string,
  subscriptionId: pulumi.Input<string>,
  foundation: ReturnType<typeof createFoundation>,
  northNetwork: ReturnType<typeof createAksNorthNetwork>,
  aimieOnlyEnabled = false,
) {
  if (!enabled && !aimieOnlyEnabled) return;

  const group = new resources.ResourceGroup(
    "shared-storage-northcentral-group",
    {
      resourceGroupName: "shared-storage-northcentral",
      location: "northcentralus",
      tags: { Environment: environmentName },
    },
  );
  const subnet = new network.Subnet(
    "shared-storage-northcentral-subnet",
    {
      resourceGroupName: northNetwork.group.name,
      virtualNetworkName: northNetwork.vnet.name,
      subnetName: "private-endpoints",
      addressPrefix: "172.28.243.128/25",
      privateEndpointNetworkPolicies: "Disabled",
    },
    { dependsOn: [northNetwork.ready] },
  );
  const suffix = armUniqueString("subscription", subscriptionId).apply(
    (value) => value.slice(0, 10),
  );
  let account: ReturnType<typeof createAccount> | undefined;
  if (enabled) {
    account = createAccount(
      "shared-data-storage",
      group,
      pulumi.interpolate`probonolawdata${suffix}`,
      "northcentralus",
      environmentName,
      {
        // Preserve integrity-cache's geo redundancy and require data-plane RBAC.
        geoRedundant: true,
        retainedBlobs: true,
        fileShareRetentionDays: 14,
        containers: ["exhibits", "input", "results"],
        allowSharedKeyAccess: false,
        // Video Indexer fetches input with its managed identity through the
        // trusted Azure services exception. The firewall remains default-deny.
        publicNetworkAccess: "Enabled",
      },
    );
    createStoragePrivateEndpointsForService(
      foundation,
      group,
      { "aks/shared-data": subnet },
      account,
      {
        key: "sharedDataNorthCentral",
        subnetKey: "aks/shared-data",
        networkKey: "logic",
        location: "northcentralus",
        // AKS uses Blob, Queue, and Table; legacy Functions content shares are excluded.
        groupIds: ["blob", "queue", "table"],
      },
    );
  }
  const aimieAccount = createAccount(
    "shared-aimie-storage",
    group,
    pulumi.interpolate`aimiedata${suffix}`,
    "northcentralus",
    environmentName,
    {
      // Preserve AIMIE Config's geo redundancy for the combined AIMIE account.
      geoRedundant: true,
      retainedBlobs: true,
      allowSharedKeyAccess: false,
      publicNetworkAccess: "Disabled",
    },
  );
  const aimieAgents = new storage.BlobContainer("shared-aimie-storage-agents", {
    accountName: aimieAccount.name,
    resourceGroupName: group.name,
    containerName: "agents",
    immutableStorageWithVersioning: { enabled: false },
    defaultEncryptionScope: "$account-encryption-key",
    denyEncryptionScopeOverride: false,
    publicAccess: "None",
  });
  createStoragePrivateEndpointsForService(
    foundation,
    group,
    { "aks/shared-aimie": subnet },
    aimieAccount,
    {
      key: "sharedAimieNorthCentral",
      subnetKey: "aks/shared-aimie",
      networkKey: "logic",
      location: "northcentralus",
      groupIds: ["blob", "queue", "table"],
    },
  );
  return { group, subnet, account, aimieAccount, aimieAgents };
}
