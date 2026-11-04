import {
  cognitiveservices,
  managedidentity,
  resources,
} from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";
import { assign, createVideoIndexerTokenRole } from "../../core/iam";
import { armUniqueString } from "../../naming";
import { createPrivateEndpoint } from "../../privateEndpoint";
import type { ServiceContext } from "../context";

export const key = "dataIntegrityExtractor";
export const groupName = "data-integrity-extractor";
export const groupLocation = "centralus";
export const telemetryDefinition = {
  key: "dataIntegrityExtractor",
  groupName: "data-integrity-extractor",
  workspacePrefix: "data-integrity-extractorws",
  insightPrefix: "data-integrity-extractorappinsights",
  telemetryLocation: "centralus",
  insightTagged: false,
  testInsightOverrides: {
    requestSource: "IbizaAIExtensionEnablementBlade",
    disableLocalAuth: undefined,
  },
  productionInsightOverrides: {
    requestSource: "IbizaAIExtensionEnablementBlade",
    disableLocalAuth: undefined,
  },
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
export function createAccess(ctx: ServiceContext) {
  const test = ctx.environmentName === "Test";
  const customRole = createVideoIndexerTokenRole(
    ctx.subscriptionId,
    ctx.environmentName,
    test
      ? "/subscriptions/00000000-0000-4000-8000-000000000003/providers/Microsoft.Authorization/roleDefinitions/00000000-0000-4000-8000-00000000000e"
      : undefined,
  );
  const workloadIdentity = managedidentity.getUserAssignedIdentityOutput({
    resourceGroupName: test
      ? "probono-law-aks-prototype"
      : "probono-law-aks-production",
    resourceName: test
      ? "file-operations-test-workload"
      : "file-operations-prod-workload",
  });
  assign(
    "integrity-extractor-aks-video-indexer-v2-token",
    ctx.videoIndexer.account.id,
    workloadIdentity.principalId,
    customRole.id,
    "ServicePrincipal",
    ctx.videoIndexer.importedAccountId +
      "/providers/Microsoft.Authorization/roleAssignments/" +
      ctx.videoIndexer.definition.workloadAssignment,
  );
}

export function createAdditionalResources(ctx: ServiceContext) {
  const { foundation, groups, subnets, environmentName } = ctx;
  const extractorGroup = groups["data-integrity-extractor"];
  const extractorSuffix = armUniqueString(
    "data-integrity-extractor-rg",
    extractorGroup.id,
  );
  const documentIngressName = pulumi.interpolate`aimienotificationpubsub${extractorSuffix.apply((suffix) => suffix.slice(0, 8))}`;
  const documentIngress = new cognitiveservices.Account(
    "document-integrity-cognitive-services",
    {
      accountName: documentIngressName,
      resourceGroupName: extractorGroup.name,
      location: "eastus",
      tags: {
        Environment:
          environmentName === "Production" ? "Development" : environmentName,
      },
      sku: { name: "S0" },
      kind: "CognitiveServices",
      identity: { type: "None" },
      properties: {
        customSubDomainName: documentIngressName,
        allowProjectManagement: false,
        networkAcls: {
          defaultAction: "Deny",
          virtualNetworkRules: [],
        },
        publicNetworkAccess: "Enabled",
      },
    },
  );
  const cognitiveZone = "privatelink.cognitiveservices.azure.com";
  createPrivateEndpoint(
    "document-integrity-cognitive-services-pe",
    "aks-nc-document-ingress-pe",
    extractorGroup,
    "northcentralus",
    subnets["aks/private-endpoints"],
    documentIngress.id,
    ["account"],
    cognitiveZone,
    foundation.dnsZones.logic[cognitiveZone].id,
    {},
    [],
    "default",
  );
  return { documentIngressId: documentIngress.id };
}
