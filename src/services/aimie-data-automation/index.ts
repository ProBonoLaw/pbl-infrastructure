import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "dataAutomation";
export const groupName = "aimie-data-automation";
export const groupLocation = "westcentralus";
export const telemetryDefinition = {
  key: "dataAutomation",
  groupName: "aimie-data-automation",
  workspacePrefix: "aimie-data-automationws",
  insightPrefix: "aimie-data-automationappinsights",
  telemetryLocation: "northcentralus",
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
