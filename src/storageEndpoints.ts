import * as pulumi from "@pulumi/pulumi";
import { resources, storage } from "@pulumi/azure-native";
import { createFoundation } from "./foundation";
import { armUniqueString } from "./naming";
import { createPrivateEndpoint } from "./privateEndpoint";
import type { Subnets } from "./subnets";

const zones = [
  { groupId: "blob", zoneName: "privatelink.blob.core.windows.net" },
  { groupId: "file", zoneName: "privatelink.file.core.windows.net" },
  { groupId: "table", zoneName: "privatelink.table.core.windows.net" },
  { groupId: "queue", zoneName: "privatelink.queue.core.windows.net" },
] as const;

export function createStoragePrivateEndpointsForService(
  foundation: ReturnType<typeof createFoundation>,
  group: resources.ResourceGroup,
  subnets: Subnets,
  account: storage.StorageAccount,
  definition: {
    key: string;
    subnetKey: string;
    networkKey: "logic";
    location: string;
    endpointNameSuffix?: string;
    groupIds?: readonly (typeof zones)[number]["groupId"][];
  },
) {
  const { key, subnetKey, networkKey, location, endpointNameSuffix, groupIds } =
    definition;
  if (!subnets[subnetKey]) {
    throw new Error(`Missing private endpoint subnet: ${subnetKey}`);
  }
  const prefix: pulumi.Input<string> =
    key === "resourceManager"
      ? "storageaccount-resource-manager-vnet"
      : account.name;
  for (const [index, { groupId, zoneName }] of zones.entries()) {
    // Preserve indexes so the remaining endpoint names do not change.
    if (groupIds && !groupIds.includes(groupId)) continue;
    const suffix = armUniqueString(`storage-zone-${groupId}`, zoneName).apply(
      (value) => value.slice(0, 8),
    );
    const endpointName = pulumi.interpolate`${prefix}-${suffix}-${index}${endpointNameSuffix ?? ""}`;
    createPrivateEndpoint(
      `${key}-storage-${groupId}-pe`,
      endpointName,
      group,
      location,
      subnets[subnetKey],
      account.id,
      [groupId],
      zoneName,
      foundation.dnsZones[networkKey][zoneName].id,
    );
  }
}
