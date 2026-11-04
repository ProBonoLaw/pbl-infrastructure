import {
  managedidentity,
  network,
  resources,
  storage,
} from "@pulumi/azure-native";
import { videoindexer } from "@pulumi/azure-native_videoindexer_v20250401";
import * as pulumi from "@pulumi/pulumi";
import { assign, roleIds } from "./core/iam";
import { createFoundation } from "./foundation";

// Adopt the replacements after their private-network indexing canaries succeeded.
export const replacementVideoIndexer = {
  Test: {
    subscription: "00000000-0000-4000-8000-000000000003",
    name: "video-indexer-v2-testsuffix001",
    accountId: "00000000-0000-4000-8000-00000000000a",
    storageAssignment: "00000000-0000-4000-8000-00000000002f",
    workloadAssignment: "00000000-0000-4000-8000-00000000001b",
  },
  Production: {
    subscription: "00000000-0000-4000-8000-000000000002",
    name: "video-indexer-v2-prodsuffix001",
    accountId: "00000000-0000-4000-8000-00000000000b",
    storageAssignment: "00000000-0000-4000-8000-000000000030",
    workloadAssignment: "00000000-0000-4000-8000-000000000031",
  },
} as const;

export function createVideoIndexer(
  foundation: ReturnType<typeof createFoundation>,
  groups: Record<string, resources.ResourceGroup>,
  subnet: network.Subnet,
  sharedData: storage.StorageAccount,
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
) {
  const definition =
    replacementVideoIndexer[
      environmentName as keyof typeof replacementVideoIndexer
    ];
  if (
    !definition ||
    new pulumi.Config("azure-native").require("subscriptionId") !==
      definition.subscription
  )
    throw new Error(
      "Video Indexer replacement imports require the matching environment subscription",
    );
  const group = groups["video-indexer"];
  const root =
    "/subscriptions/" +
    definition.subscription +
    "/resourceGroups/video-indexer";
  const accountId =
    root + "/providers/Microsoft.VideoIndexer/accounts/" + definition.name;
  // Match the identity ID returned by Azure when the VI binding was created.
  // Even a casing-only difference would otherwise schedule a binding update.
  const identityId =
    root.replace("resourceGroups", "resourcegroups") +
    "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/" +
    definition.name +
    "-identity";
  const identity = new managedidentity.UserAssignedIdentity(
    "video-indexer-v2-identity",
    {
      resourceName: definition.name + "-identity",
      resourceGroupName: group.name,
      location: "eastus",
      tags: { Purpose: "StorageConsolidation" },
    },
    { import: identityId },
  );
  const storageScope =
    "/subscriptions/" +
    definition.subscription +
    "/resourceGroups/shared-storage-northcentral/providers/Microsoft.Storage/storageAccounts/" +
    (environmentName === "Test"
      ? "probonolawdatatestsuffix"
      : "probonolawdataprodsuffix");
  const storageGrant = assign(
    "video-indexer-v2-storage-contributor",
    sharedData.id,
    identity.principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.blobContributor}`,
    "ServicePrincipal",
    storageScope +
      "/providers/Microsoft.Authorization/roleAssignments/" +
      definition.storageAssignment,
  );
  const account = new videoindexer.Account(
    "video-indexer-v2-account",
    {
      accountName: definition.name,
      accountId: definition.accountId,
      resourceGroupName: group.name,
      location: "eastus",
      tags: { Environment: environmentName, Purpose: "StorageConsolidation" },
      identity: { type: "UserAssigned", userAssignedIdentities: [identity.id] },
      publicNetworkAccess: "Disabled",
      storageServices: {
        resourceId: sharedData.id,
        userAssignedIdentity: identity.id,
      },
    },
    {
      import: accountId,
      dependsOn: [storageGrant],
      ignoreChanges: ["accountId", "privateEndpointConnections"],
    },
  );
  const endpointName = definition.name + "-pe";
  const endpointId =
    root + "/providers/Microsoft.Network/privateEndpoints/" + endpointName;
  const endpoint = new network.PrivateEndpoint(
    "video-indexer-v2-pe",
    {
      privateEndpointName: endpointName,
      resourceGroupName: group.name,
      location: "northcentralus",
      subnet: { id: subnet.id },
      privateLinkServiceConnections: [
        {
          name: endpointName,
          privateLinkServiceId: account.id,
          groupIds: ["account"],
        },
      ],
    },
    {
      import: endpointId,
      ignoreChanges: [
        "customDnsConfigs",
        "customNetworkInterfaceName",
        "privateLinkServiceConnections[0].id",
        "privateLinkServiceConnections[0].privateLinkServiceConnectionState",
        "subnet.privateEndpointNetworkPolicies",
        "subnet.privateLinkServiceNetworkPolicies",
      ],
    },
  );
  const zoneName = "privatelink.api.videoindexer.ai";
  new network.PrivateDnsZoneGroup(
    "video-indexer-v2-pe-dns",
    {
      privateDnsZoneGroupName: "default",
      privateEndpointName: endpoint.name,
      resourceGroupName: group.name,
      privateDnsZoneConfigs: [
        {
          name: zoneName,
          privateDnsZoneId: foundation.dnsZones.logic[zoneName].id,
        },
      ],
    },
    {
      import: endpointId + "/privateDnsZoneGroups/default",
      ignoreChanges: ["name"],
    },
  );
  return { account, identity, definition, importedAccountId: accountId };
}
