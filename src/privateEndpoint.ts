import * as pulumi from "@pulumi/pulumi";
import { network, resources } from "@pulumi/azure-native";
import type { network as networkInputs } from "@pulumi/azure-native/types/input";
import { armUniqueString } from "./naming";

export function createPrivateEndpoint(
  logicalName: string,
  endpointName: pulumi.Input<string>,
  group: resources.ResourceGroup,
  location: string,
  subnet: network.Subnet,
  targetId: pulumi.Input<string>,
  groupIds: string[],
  zoneName: string,
  zoneId: pulumi.Input<string>,
  resourceOptions: pulumi.CustomResourceOptions = {},
  additionalPrivateDnsZoneConfigs: networkInputs.PrivateDnsZoneConfigArgs[] = [],
  dnsGroupName?: pulumi.Input<string>,
) {
  const endpoint = new network.PrivateEndpoint(
    logicalName,
    {
      privateEndpointName: endpointName,
      resourceGroupName: group.name,
      location,
      privateLinkServiceConnections: [
        {
          name: endpointName,
          privateLinkServiceId: targetId,
          groupIds,
        },
      ],
      subnet: { id: subnet.id },
    },
    {
      ...resourceOptions,
      ignoreChanges: [
        ...(resourceOptions.ignoreChanges ?? []),
        "customDnsConfigs",
        "customNetworkInterfaceName",
        "privateLinkServiceConnections[0].id",
        "privateLinkServiceConnections[0].privateLinkServiceConnectionState",
        "subnet.privateEndpointNetworkPolicies",
        "subnet.privateLinkServiceNetworkPolicies",
      ],
    },
  );
  new network.PrivateDnsZoneGroup(
    `${logicalName}-dns`,
    {
      privateDnsZoneGroupName:
        dnsGroupName ??
        pulumi.interpolate`default-${armUniqueString(`${logicalName}-dns`, endpoint.id)}`,
      privateEndpointName: endpoint.name,
      resourceGroupName: group.name,
      privateDnsZoneConfigs: [
        { name: zoneName, privateDnsZoneId: zoneId },
        ...additionalPrivateDnsZoneConfigs,
      ],
    },
    { ignoreChanges: ["name"] },
  );
  return endpoint;
}
