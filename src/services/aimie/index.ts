import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "aimie";
export const groupName = "aimie-service";
export const groupLocation = "centralus";
export const telemetryDefinition = {
  key: "aimie",
  groupName: "aimie-service",
  workspacePrefix: "aimie-servicews",
  insightPrefix: "aimie-serviceappinsights",
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
