import { resources } from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";
import { createCosmos } from "./cosmos";
import { createFoundation } from "./foundation";
import { createFoundry } from "./foundry";
import { createPrivateEndpoint } from "./privateEndpoint";
import type { Subnets } from "./subnets";

export function createSharedPrivateEndpoints(
  foundation: ReturnType<typeof createFoundation>,
  groups: Record<string, resources.ResourceGroup>,
  subnets: Subnets,
  cosmos: ReturnType<typeof createCosmos>,
  foundry: ReturnType<typeof createFoundry>,
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
) {
  const searchName =
    environmentName === "Test" ? "aimie-search-59364" : "aimie-search-74239";
  const searchZone = "privatelink.search.windows.net";
  createPrivateEndpoint(
    "search-northcentral-pe",
    "aks-nc-search-pe",
    groups["shared-dbs"],
    "northcentralus",
    subnets["aks/private-endpoints"],
    pulumi.interpolate`${subscriptionId}/resourceGroups/shared-dbs/providers/Microsoft.Search/searchServices/${searchName}`,
    ["searchService"],
    "privatelink-search-windows-net",
    foundation.dnsZones.logic[searchZone].id,
    {},
    [],
    "default",
  );
  const documentsZone = "privatelink.documents.azure.com";
  createPrivateEndpoint(
    "cosmos-serverless-pilot-logic-pe",
    "aks-nc-cosmos-pe",
    groups["shared-dbs"],
    "northcentralus",
    subnets["aks/private-endpoints"],
    cosmos.serverless.account.id,
    ["Sql"],
    documentsZone,
    foundation.dnsZones.logic[documentsZone].id,
    {},
    [],
    "default",
  );

  const cognitiveZone = "privatelink.cognitiveservices.azure.com";
  const foundryEndpoints = [
    {
      logicalName: "aimie3-logic",
      endpointName: "aks-nc-foundry-pe",
      groupKey: "primary-foundry",
      location: "northcentralus",
      networkKey: "logic",
      targetId: foundry.primary.id,
    },
    {
      logicalName: "data-loader-logic",
      endpointName: "aks-nc-data-loader-pe",
      groupKey: "data-loader-foundry",
      location: "northcentralus",
      networkKey: "logic",
      targetId: foundry.dataLoader.id,
    },
    {
      logicalName: "cognitive-logic",
      endpointName: "aks-nc-document-intelligence-pe",
      groupKey: "data-loader-foundry",
      location: "northcentralus",
      networkKey: "logic",
      targetId: foundry.cognitive.id,
    },
  ] as const;
  for (const {
    logicalName,
    endpointName,
    groupKey,
    location,
    networkKey,
    targetId,
  } of foundryEndpoints) {
    const additionalPrivateDnsZoneConfigs =
      logicalName === "aimie3-logic" || logicalName === "data-loader-logic"
        ? [
            {
              name: "privatelink.openai.azure.com",
              privateDnsZoneId:
                foundation.dnsZones[networkKey]["privatelink.openai.azure.com"]
                  .id,
            },
            {
              name: "privatelink.services.ai.azure.com",
              privateDnsZoneId:
                foundation.dnsZones[networkKey][
                  "privatelink.services.ai.azure.com"
                ].id,
            },
          ]
        : [];
    createPrivateEndpoint(
      `${logicalName}-pe`,
      endpointName,
      groups[groupKey],
      location,
      subnets["aks/private-endpoints"],
      targetId,
      ["account"],
      cognitiveZone,
      foundation.dnsZones[networkKey][cognitiveZone].id,
      {},
      additionalPrivateDnsZoneConfigs,
      "default",
    );
  }
}
