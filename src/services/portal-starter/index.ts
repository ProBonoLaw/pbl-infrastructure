import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "portalStarter";
export const groupName = "portal-starter";
export const groupLocation = "westcentralus";
export const telemetryDefinition = {
  key: "portalStarter",
  groupName: "portal-starter",
  workspacePrefix: "portal-starterws",
  insightPrefix: "portal-starterappinsights",
  telemetryLocation: "centralus",
  insightTagged: false,
};

export function createGroup(
  groups: ServiceContext["groups"],
  environmentName: string,
) {
  groups[groupName] = new resources.ResourceGroup(groupName, {
    resourceGroupName: groupName,
    location: groupLocation,
    tags: {
      Environment:
        environmentName === "Production" ? "AzureCloud" : environmentName,
    },
  });
}
