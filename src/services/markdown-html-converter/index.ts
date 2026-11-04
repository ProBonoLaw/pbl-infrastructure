import { resources } from "@pulumi/azure-native";
import type { ServiceContext } from "../context";

export const key = "markdownConverter";
export const groupName = "markdown-html-converter";
export const groupLocation = "centralus";
export const telemetryDefinition = {
  key: "markdownConverter",
  groupName: "markdown-html-converter",
  workspacePrefix: "markdown-html-converterws",
  insightPrefix: "markdown-html-converterappinsights",
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
