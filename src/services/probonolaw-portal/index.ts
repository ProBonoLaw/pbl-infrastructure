import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "probonoPortal";
export const groupName = "probonolaw-portal";
export const groupLocation = "centralus";
export const telemetryDefinition = {
  key: "probonoPortal",
  groupName: "probonolaw-portal",
  workspacePrefix: "probonolaw-portalws",
  insightPrefix: "probonolaw-portalappinsights",
  planPrefix: "probonolaw-portalfarm",
  telemetryLocation: "centralus",
  planLocation: "centralus",
  capacity: 1,
  maxWorkers: 1,
  workerCount: 0,
  reserved: true,
  planTagged: true,
  insightTagged: false,
  productionPlanOverrides: { tags: { Environment: "AzureCloud" } },
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
