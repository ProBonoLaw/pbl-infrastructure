import * as pulumi from "@pulumi/pulumi";
import { eventhub, resources } from "@pulumi/azure-native";
import { eventhub as eventhub20240501preview } from "@pulumi/azure-native_eventhub_v20240501preview";
import { createFoundation } from "./foundation";
import { armUniqueString } from "./naming";
import { createPrivateEndpoint } from "./privateEndpoint";
import type { Subnets } from "./subnets";

const consolidatedHubs = [
  { name: "state-events", partitions: 4, days: 7, tombstoneHours: 96 },
  { name: "file-operations", partitions: 12, days: 7, tombstoneHours: 0 },
  { name: "email-operations", partitions: 12, days: 7, tombstoneHours: 0 },
  { name: "account-operations", partitions: 17, days: 7, tombstoneHours: 0 },
  { name: "chatbot-trigger", partitions: 8, days: 7, tombstoneHours: 0 },
  { name: "aimie-request-queue", partitions: 8, days: 7, tombstoneHours: 0 },
  { name: "aimie-response-queue", partitions: 8, days: 7, tombstoneHours: 0 },
  {
    name: "declaration-processing-requests",
    partitions: 8,
    days: 7,
    tombstoneHours: 0,
  },
] as const;
const consolidatedConsumers = [
  { hubName: "state-events", consumerName: "addworkflow" },
  { hubName: "state-events", consumerName: "create-sharepoint-site" },
  { hubName: "state-events", consumerName: "update-account-information" },
  { hubName: "state-events", consumerName: "emailer" },
  { hubName: "file-operations", consumerName: "data-deletion-flow" },
  { hubName: "file-operations", consumerName: "dataingestionflow" },
  { hubName: "file-operations", consumerName: "evidence-extraction-group" },
  { hubName: "file-operations", consumerName: "ingestion-group" },
  { hubName: "file-operations", consumerName: "ingestion-group-shard-1" },
  {
    hubName: "email-operations",
    consumerName: "email-account-procurement-service",
  },
  { hubName: "email-operations", consumerName: "process-requests" },
  { hubName: "chatbot-trigger", consumerName: "copilot-trigger-consumer" },
  { hubName: "aimie-request-queue", consumerName: "declaration-consumer" },
  { hubName: "aimie-request-queue", consumerName: "discovery-consumer" },
  { hubName: "aimie-request-queue", consumerName: "qa-consumer" },
  { hubName: "aimie-request-queue", consumerName: "argument-builder-consumer" },
  { hubName: "aimie-request-queue", consumerName: "timeline-builder-consumer" },
  { hubName: "aimie-response-queue", consumerName: "chatbot-consumer" },
  { hubName: "aimie-response-queue", consumerName: "declaration-consumer" },
  { hubName: "aimie-response-queue", consumerName: "declaration-qa" },
  {
    hubName: "aimie-response-queue",
    consumerName: "argument-builder-consumer",
  },
  {
    hubName: "aimie-response-queue",
    consumerName: "timeline-builder-consumer",
  },
  { hubName: "aimie-response-queue", consumerName: "discovery-consumer" },
  {
    hubName: "declaration-processing-requests",
    consumerName: "declaration-generation-service",
  },
  {
    hubName: "declaration-processing-requests",
    consumerName: "qa-generation-service",
  },
  {
    hubName: "declaration-processing-requests",
    consumerName: "argument-builder-service",
  },
] as const;

function createNamespace(
  logicalName: string,
  namespaceName: pulumi.Input<string>,
  group: resources.ResourceGroup,
  environmentName: string,
  overrides: Partial<eventhub.NamespaceArgs> = {},
) {
  return new eventhub.Namespace(
    logicalName,
    {
      namespaceName,
      resourceGroupName: group.name,
      location: "westcentralus",
      tags: { Environment: environmentName },
      sku: { name: "Standard", tier: "Standard", capacity: 1 },
      minimumTlsVersion: "1.2",
      publicNetworkAccess: "Enabled",
      disableLocalAuth: false,
      zoneRedundant: false,
      isAutoInflateEnabled: false,
      maximumThroughputUnits: 0,
      kafkaEnabled: true,
      ...overrides,
    },
    { ignoreChanges: ["privateEndpointConnections"] },
  );
}

function createHubs(
  logicalName: string,
  namespace: eventhub.Namespace,
  group: resources.ResourceGroup,
  definitions: readonly {
    name: string;
    partitions: number;
    days: number;
    tombstoneHours: number;
  }[],
  extraConsumers: readonly { hubName: string; consumerName: string }[],
  createDefaultConsumerGroup = true,
) {
  const hubs: Record<
    string,
    eventhub.EventHub | eventhub20240501preview.EventHub
  > = {};
  for (const { name, partitions, days, tombstoneHours } of definitions) {
    const hubArgs = {
      eventHubName: name,
      namespaceName: namespace.name,
      resourceGroupName: group.name,
      retentionDescription: tombstoneHours
        ? {
            cleanupPolicy: "Compact",
            retentionTimeInHours: -1,
            tombstoneRetentionTimeInHours: tombstoneHours,
          }
        : { cleanupPolicy: "Delete", retentionTimeInHours: days * 24 },
      messageRetentionInDays: days,
      partitionCount: partitions,
      status: "Active",
    } satisfies eventhub.EventHubArgs;
    const options = tombstoneHours
      ? { ignoreChanges: ["messageRetentionInDays"] }
      : undefined;
    const hubLogicalName = `${logicalName}-${name}`;
    // The default Event Hubs API rejects creation of a compacted hub here.
    // Match the API version used by the original compacted Bicep hubs.
    hubs[name] =
      logicalName === "consolidated" && name === "state-events"
        ? new eventhub20240501preview.EventHub(hubLogicalName, hubArgs, options)
        : new eventhub.EventHub(hubLogicalName, hubArgs, options);
    if (createDefaultConsumerGroup) {
      new eventhub.ConsumerGroup(`${logicalName}-${name}-default`, {
        consumerGroupName: "$Default",
        eventHubName: hubs[name].name,
        namespaceName: namespace.name,
        resourceGroupName: group.name,
      });
    }
  }
  for (const { hubName, consumerName } of extraConsumers) {
    new eventhub.ConsumerGroup(`${logicalName}-${hubName}-${consumerName}`, {
      consumerGroupName: consumerName,
      eventHubName: hubs[hubName].name,
      namespaceName: namespace.name,
      resourceGroupName: group.name,
    });
  }
  return hubs;
}

function rule(
  logicalName: string,
  namespace: eventhub.Namespace,
  group: resources.ResourceGroup,
  name: string,
  rights: string[],
) {
  return new eventhub.NamespaceAuthorizationRule(logicalName, {
    authorizationRuleName: name,
    namespaceName: namespace.name,
    resourceGroupName: group.name,
    rights,
  });
}

export function createEventHubs(
  foundation: ReturnType<typeof createFoundation>,
  groups: Record<string, resources.ResourceGroup>,
  subnets: Subnets,
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
) {
  const suffix = armUniqueString("subscription", subscriptionId).apply(
    (value) => value.slice(0, 10),
  );
  const ingestionGroup =
    groups["probono-law-data-ingestion-event-hubs-service"];
  const consolidatedPublicNetworkAccess =
    environmentName === "Test" ? "Enabled" : "Disabled";
  const consolidated = createNamespace(
    "consolidated-eventhub",
    pulumi.interpolate`probonolawsharedhe${suffix}`,
    ingestionGroup,
    environmentName,
    {
      isAutoInflateEnabled: true,
      maximumThroughputUnits: 2,
      publicNetworkAccess: consolidatedPublicNetworkAccess,
    },
  );
  rule(
    "consolidated-eventhub-copilot-rule",
    consolidated,
    ingestionGroup,
    "Copilot",
    ["Manage", "Listen", "Send"],
  );
  rule("consolidated-eventhub-ui-rule", consolidated, ingestionGroup, "PB-UI", [
    "Send",
  ]);
  const consolidatedTopics = createHubs(
    "consolidated",
    consolidated,
    ingestionGroup,
    consolidatedHubs,
    consolidatedConsumers,
    false, // Azure creates $Default when each new hub is provisioned.
  );
  new eventhub.NamespaceNetworkRuleSet("consolidated-eventhub-network-rules", {
    namespaceName: consolidated.name,
    resourceGroupName: ingestionGroup.name,
    publicNetworkAccess: consolidatedPublicNetworkAccess,
    defaultAction: "Deny",
    ipRules:
      environmentName === "Test"
        ? [{ action: "Allow", ipMask: "203.0.113.150" }]
        : undefined,
    trustedServiceAccessEnabled: false,
  });

  const zoneName = "privatelink.servicebus.windows.net";
  const endpoints = [
    {
      logicalName: "consolidated-logic",
      name: "aks-nc-eventhubs-pe",
      group: ingestionGroup,
      subnetKey: "aks/private-endpoints",
      networkKey: "logic",
      target: consolidated,
    },
  ] as const;
  for (const {
    logicalName,
    name,
    group,
    subnetKey,
    networkKey,
    target,
  } of endpoints) {
    createPrivateEndpoint(
      `${logicalName}-eventhub-pe`,
      name,
      group,
      "northcentralus",
      subnets[subnetKey],
      target.id,
      ["namespace"],
      zoneName,
      foundation.dnsZones[networkKey][zoneName].id,
      {},
      [],
      "default",
    );
  }
  return {
    consolidated,
    consolidatedTopics,
  };
}
