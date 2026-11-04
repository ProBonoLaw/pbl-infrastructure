import { network, privatedns, resources } from "@pulumi/azure-native";
import { createFoundation, privateDnsZoneNames } from "./foundation";

// AKS and every application private endpoint share this North Central US VNet.
export function createAksNorthNetwork(
  foundation: ReturnType<typeof createFoundation>,
  environmentName: string,
) {
  const group = new resources.ResourceGroup("aks-north-network-group", {
    resourceGroupName: "shared-vnet-aks-northcentral",
    location: "northcentralus",
    tags: { Environment: environmentName },
  });
  const vnet = new network.VirtualNetwork(
    "aks-north-vnet",
    {
      resourceGroupName: group.name,
      virtualNetworkName: "aks-northcentral",
      location: "northcentralus",
      addressSpace: { addressPrefixes: ["172.28.243.0/24"] },
      tags: { Environment: environmentName },
    },
    { ignoreChanges: ["subnets"] },
  );
  const subnet = new network.Subnet("aks-north-subnet", {
    resourceGroupName: group.name,
    virtualNetworkName: vnet.name,
    subnetName: "aks",
    addressPrefix: "172.28.243.0/25",
    serviceEndpoints: [{ service: "Microsoft.KeyVault", locations: ["*"] }],
    privateEndpointNetworkPolicies: "Disabled",
  });
  for (const zoneName of privateDnsZoneNames) {
    const zone = foundation.dnsZones.logic[zoneName];
    new privatedns.VirtualNetworkLink(
      `aks-north-${zoneName.replace(/[^a-zA-Z0-9]/g, "-")}-link`,
      {
        resourceGroupName: foundation.logicDnsGroup.name,
        privateZoneName: zone.name,
        virtualNetworkLinkName: "aks-northcentral-vlink",
        location: "global",
        registrationEnabled: false,
        resolutionPolicy: "Default",
        virtualNetwork: { id: vnet.id },
      },
      { dependsOn: [subnet] },
    );
  }
  return {
    group,
    vnet,
    subnet,
    ready: subnet,
  };
}
