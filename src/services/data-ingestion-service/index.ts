import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "dataIngestion";
export const groupName = "data-ingestion-svc";
export const groupLocation = "centralus";
export const telemetryDefinition = {
  key: "dataIngestion",
  groupName: "data-ingestion-svc",
  workspacePrefix: "data-ingestion-svcws",
  insightPrefix: "data-ingestion-svcappinsights",
  telemetryLocation: "centralus",
  insightTagged: false,
  testInsightOverrides: { disableLocalAuth: undefined },
  productionInsightOverrides: { disableLocalAuth: undefined },
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
