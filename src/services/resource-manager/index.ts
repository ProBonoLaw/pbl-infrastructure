import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "resourceManager";
export const groupName = "resource-manager";
export const groupLocation = "westcentralus";
export const telemetryDefinition = {
  key: "resourceManager",
  groupName: "resource-manager",
  workspacePrefix: "resourcemanagerws",
  insightPrefix: "resourcemanagerappinsights",
  telemetryLocation: "centralus",
  insightTagged: true,
  productionInsightOverrides: { tags: { Environment: "Development" } },
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
