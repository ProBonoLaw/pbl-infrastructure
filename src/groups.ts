import { resources } from "@pulumi/azure-native";

const definitions = [
  { name: "shared-dbs", location: "centralus" },
  { name: "primary-foundry", location: "centralus" },
  { name: "data-loader-foundry", location: "centralus" },
  { name: "integrity-cache", location: "westcentralus" },
  { name: "aimie-config", location: "centralus" },
  { name: "video-indexer", location: "eastus" },
  {
    name: "probono-law-data-ingestion-event-hubs-service",
    location: "westcentralus",
  },
  { name: "probono-law-requirement-fulfillment", location: "westcentralus" },
  { name: "web-site-data-ingestion", location: "westcentralus" },
  { name: "customer-account-kv", location: "centralus" },
  { name: "onboarding-dpl", location: "centralus" },
] as const;

const productionAzureCloudGroups = new Set([
  "integrity-cache",
  "aimie-config",
  "web-site-data-ingestion",
  "customer-account-kv",
  "onboarding-dpl",
]);

export function createResourceGroups(environmentName: string) {
  const groups: Record<string, resources.ResourceGroup> = {};
  for (const { name, location } of definitions) {
    groups[name] = new resources.ResourceGroup(name, {
      resourceGroupName: name,
      location,
      tags: {
        Environment:
          environmentName === "Production" &&
          productionAzureCloudGroups.has(name)
            ? "AzureCloud"
            : environmentName,
      },
    });
  }
  return groups;
}
