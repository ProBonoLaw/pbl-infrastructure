import * as pulumi from "@pulumi/pulumi";
import { cognitiveservices, resources } from "@pulumi/azure-native";
import { cognitiveservices as cognitiveservices20260501 } from "@pulumi/azure-native_cognitiveservices_v20260501";
import { armUniqueString } from "./naming";

// Foundry account names can be set with Pulumi config (primaryFoundryName,
// dataLoaderFoundryName) or, for GitHub Actions, the FOUNDRY_PRIMARY_NAME and
// FOUNDRY_DATA_LOADER_NAME variables. An account name is also its custom
// subdomain, so it must be globally unique and cannot be changed in place.
function foundryNameOverride(
  configKey: string,
  envVar: string,
): string | undefined {
  const value =
    new pulumi.Config().get(configKey) || process.env[envVar] || undefined;
  if (value !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/i.test(value)) {
    throw new Error(
      `${configKey}/${envVar} must be 2-64 letters, digits, or hyphens, and cannot start or end with a hyphen`,
    );
  }
  return value;
}

// Shared capacities use the larger live value from Test or Production.
// Availability, model versions, and policies may still differ by environment.
const primaryDeployments = [
  {
    capacity: 167,
    modelName: "gpt-4o-transcribe-diarize",
    modelVersion: "2025-10-15",
    name: "gpt-4o-transcribe-diarize",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 100,
    modelName: "gpt-4o-transcribe",
    modelVersion: "2025-03-20",
    name: "gpt-4o-transcribe",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 328,
    modelName: "gpt-4o-mini-tts",
    modelVersion: "2025-03-20",
    name: "gpt-4o-mini-tts",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 1005,
    modelName: "gpt-4.1-nano",
    modelVersion: "2025-04-14",
    name: "question-generator-nano",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 350,
    modelName: "text-embedding-3-large",
    modelVersion: "1",
    name: "text-embedding-3-large",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "Standard",
    upgrade: "NoAutoUpgrade",
  },
  {
    capacity: 738,
    modelName: "text-embedding-3-small",
    modelVersion: "1",
    name: "text-embedding-3-small",
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "NoAutoUpgrade",
  },
  {
    capacity: 200,
    modelName: "gpt-5.1",
    modelVersion: "2025-11-13",
    name: "rhetoric-generator-gpt-5.1",
    raiPolicyName: "CourtDocs",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 150,
    modelName: "gpt-5.2",
    modelVersion: "2025-12-11",
    name: "cross-examination-gpt-5.2",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 200,
    modelName: "gpt-5.1",
    modelVersion: "2025-11-13",
    name: "declaration-final-generator-5.1",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 200,
    modelName: "gpt-5.1",
    modelVersion: "2025-11-13",
    name: "fact-finder-5.1",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 200,
    modelName: "gpt-5.1",
    modelVersion: "2025-11-13",
    name: "final-decision-gpt-5.1",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 150,
    modelName: "gpt-5.2",
    modelVersion: "2025-12-11",
    name: "final-declaration-gpt-5.2",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 150,
    modelName: "gpt-5.2",
    modelVersion: "2025-12-11",
    name: "gpt-5.2-doc-loader-fact-finder",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 150,
    modelName: "gpt-5.2",
    modelVersion: "2025-12-11",
    name: "gpt-5.2-final-decision-argument",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 1000,
    modelName: "gpt-5",
    modelVersion: "2025-08-07",
    name: "gpt-5-final-response",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 1000,
    modelName: "gpt-5-mini",
    modelVersion: "2025-08-07",
    name: "gpt-5-mini-qa",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5000,
    modelName: "gpt-5-nano",
    modelVersion: "2025-08-07",
    name: "gpt-5-nano-qa",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 150,
    modelName: "gpt-5.2",
    modelVersion: "2025-12-11",
    name: "initial-argument-gpt-5.2",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 200,
    modelName: "gpt-5.1",
    modelVersion: "2025-11-13",
    name: "qa-full-5.1",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 200,
    modelName: "gpt-chat-latest",
    modelVersion: "2026-08-06",
    name: "qa-gpt-5.1-chat",
    production: { modelVersion: "2026-05-05" },
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 300,
    modelName: "gpt-5.2",
    modelVersion: "2025-12-11",
    name: "qa-gpt-5.2",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "DataZoneStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 10000,
    modelName: "gpt-5.4",
    modelVersion: "2026-03-05",
    name: "qa-gpt-5.4",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 10000,
    modelName: "gpt-5.4-mini",
    modelVersion: "2026-03-17",
    name: "fact-finder-gpt-5.4-mini",
    production: { raiPolicyName: "SensitiveInfoLevel" },
    raiPolicyName: "CourtDocs",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 7111,
    modelName: "gpt-5",
    modelVersion: "2025-08-07",
    name: "chat-gpt-5",
    productionEnabled: false,
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5000,
    modelName: "gpt-chat-latest",
    modelVersion: "2026-08-06",
    name: "qa-gpt-chat-latest",
    production: { modelVersion: "2026-05-28" },
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 72894,
    modelName: "gpt-5.4-nano",
    modelVersion: "2026-03-17",
    name: "question-generatorgpt-5.4-nano",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 250,
    modelName: "gpt-5.4-nano",
    modelVersion: "2026-03-17",
    name: "gpt-5.4-nano",
    productionEnabled: false,
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 55378,
    modelName: "gpt-5.4-nano",
    modelVersion: "2026-03-17",
    name: "questions-gpt-5.4-nano",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 10795,
    modelName: "gpt-5.4-mini",
    modelVersion: "2026-03-17",
    name: "qa-gpt-5.4-mini",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5723,
    modelName: "gpt-5.6-luna",
    modelVersion: "2026-07-09",
    name: "gpt-5.6-luna",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 7609,
    modelName: "gpt-5.6-terra",
    modelVersion: "2026-07-09",
    name: "gpt-5.6-terra",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5181,
    modelName: "gpt-5.6-sol",
    modelVersion: "2026-07-09",
    name: "gpt-5.6-sol",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5181,
    modelName: "gpt-6-luna",
    modelVersion: "2026-09-22",
    name: "tasks-gpt-6.0-luna",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 2158,
    modelName: "gpt-6-luna",
    modelVersion: "2026-09-22",
    name: "recon-test-gpt-6-luna",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5181,
    modelName: "gpt-6-sol",
    modelVersion: "2026-09-22",
    name: "research-gpt-6.0-sol",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5181,
    modelName: "gpt-6.1-sol",
    modelVersion: "2026-09-29",
    name: "research-gpt-6.1-sol",
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 8981,
    modelName: "model-router",
    modelVersion: "2025-11-18",
    name: "test-model-router",
    productionEnabled: false,
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 150,
    modelName: "model-router",
    modelVersion: "2025-05-19",
    name: "test1",
    productionOnly: true,
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 4440,
    modelName: "gpt-5.5",
    modelVersion: "2026-04-24",
    name: "gpt-5.5",
    productionOnly: true,
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5683,
    modelName: "claude-sonnet-5",
    modelVersion: "2",
    name: "claude-sonnet-5",
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5281,
    modelName: "claude-haiku-4-5",
    modelVersion: "2",
    name: "claude-haiku-4-5",
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 4439,
    modelName: "claude-opus-5",
    modelVersion: "2",
    name: "claude-opus-5",
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5181,
    modelName: "claude-haiku-5-5",
    modelVersion: "2",
    name: "tasks-claude-haiku-5-5",
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
  {
    capacity: 5181,
    modelName: "claude-sonnet-5-5",
    modelVersion: "2",
    name: "research-claude-sonnet-5-5",
    raiPolicyName: "Microsoft.DefaultV2",
    skuName: "GlobalStandard",
    upgrade: "NoAutoUpgrade",
    production: { upgrade: "NoAutoUpgrade" },
  },
  {
    capacity: 5963,
    modelName: "gpt-5.5",
    modelVersion: "2026-04-24",
    name: "argument-gpt-5.5",
    production: { capacity: 5560 },
    raiPolicyName: "SensitiveInfoLevel",
    skuName: "GlobalStandard",
    upgrade: "OnceNewDefaultVersionAvailable",
  },
] as const;

const severeFilters = (source: "Prompt" | "Completion") =>
  ["Violence", "Hate", "Sexual", "Selfharm"].map((name) => ({
    name,
    source,
    action: "NONE" as const,
    severityThreshold: "High" as const,
    blocking: true,
    enabled: true,
  }));

function policyFilters(courtDocs: boolean) {
  return [
    ...severeFilters("Prompt"),
    {
      name: "Jailbreak",
      source: "Prompt" as const,
      action: "NONE" as const,
      blocking: false,
      enabled: !courtDocs,
    },
    {
      name: "Indirect Attack",
      source: "Prompt" as const,
      action: "NONE" as const,
      blocking: false,
      enabled: !courtDocs,
    },
    {
      name: "Indirect Attack Spotlighting",
      source: "Prompt" as const,
      action: "NONE" as const,
      blocking: false,
      enabled: false,
    },
    ...severeFilters("Completion"),
    {
      name: "Protected Material Text",
      source: "Completion" as const,
      action: "NONE" as const,
      blocking: false,
      enabled: !courtDocs,
    },
    {
      name: "Protected Material Code",
      source: "Completion" as const,
      action: "NONE" as const,
      blocking: false,
      enabled: !courtDocs,
    },
  ];
}

function createAiAccount(
  logicalName: string,
  accountName: pulumi.Input<string>,
  group: resources.ResourceGroup,
  location: string,
  kind: "AIServices" | "CognitiveServices",
  environmentName: string,
  tagged: boolean,
) {
  return new cognitiveservices.Account(logicalName, {
    accountName,
    resourceGroupName: group.name,
    location,
    sku: { name: "S0" },
    kind,
    tags: tagged ? { Environment: environmentName } : undefined,
    identity: { type: kind === "AIServices" ? "SystemAssigned" : "None" },
    properties: {
      customSubDomainName: accountName,
      networkAcls: {
        bypass: "AzureServices",
        defaultAction: "Deny",
        ipRules:
          environmentName === "Test" ? [{ value: "203.0.113.150" }] : undefined,
      },
      allowProjectManagement: kind === "AIServices",
      defaultProject:
        kind === "AIServices"
          ? pulumi.interpolate`${accountName}-project`
          : undefined,
      associatedProjects:
        kind === "AIServices"
          ? [pulumi.interpolate`${accountName}-project`]
          : undefined,
      publicNetworkAccess: "Enabled",
    },
  });
}

function disableDefenderForAi(
  logicalName: string,
  account: cognitiveservices.Account,
  group: resources.ResourceGroup,
) {
  // The default Azure Native Cognitive Services SDK does not expose this
  // account child resource, so deploy the original API through Native ARM.
  new resources.Deployment(
    `${logicalName}-defender-settings`,
    {
      deploymentName: `pulumi-${logicalName}-defender-settings`,
      resourceGroupName: group.name,
      properties: {
        mode: "Incremental",
        parameters: { accountName: { value: account.name } },
        template: {
          $schema:
            "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
          contentVersion: "1.0.0.0",
          parameters: { accountName: { type: "string" } },
          resources: [
            {
              type: "Microsoft.CognitiveServices/accounts/defenderForAISettings",
              apiVersion: "2025-06-01",
              name: "[concat(parameters('accountName'), '/Default')]",
              properties: { state: "Disabled" },
            },
          ],
        },
      },
    },
    { dependsOn: [account] },
  );
}

export function createFoundry(
  groups: Record<string, resources.ResourceGroup>,
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
) {
  const suffix = armUniqueString("subscription", subscriptionId);
  const primaryNameOverride = foundryNameOverride(
    "primaryFoundryName",
    "FOUNDRY_PRIMARY_NAME",
  );
  const dataLoaderNameOverride = foundryNameOverride(
    "dataLoaderFoundryName",
    "FOUNDRY_DATA_LOADER_NAME",
  );
  // Existing deployments are imported under the account's current name.
  const primaryImportName =
    primaryNameOverride ??
    (environmentName === "Test" ? "aimie3-testsuffix001" : "aimie3-prodsuffix001");
  const primary = createAiAccount(
    "aimie3-foundry",
    primaryNameOverride ?? pulumi.interpolate`aimie3-${suffix}`,
    groups["primary-foundry"],
    "eastus2",
    "AIServices",
    environmentName,
    false,
  );
  disableDefenderForAi("aimie3", primary, groups["primary-foundry"]);
  const primaryProject = new cognitiveservices.Project("aimie3-project", {
    accountName: primary.name,
    projectName: pulumi.interpolate`${primary.name}-project`,
    resourceGroupName: groups["primary-foundry"].name,
    location: "eastus2",
    identity: { type: "SystemAssigned" },
  });
  const policies: Record<string, cognitiveservices.RaiPolicy> = {};
  for (const { name, courtDocs } of [
    { name: "SensitiveInfoLevel", courtDocs: false },
    { name: "CourtDocs", courtDocs: true },
  ] as const) {
    policies[name] = new cognitiveservices.RaiPolicy(
      `aimie3-${name}`,
      {
        accountName: primary.name,
        raiPolicyName: name,
        resourceGroupName: groups["primary-foundry"].name,
        properties: {
          mode: "Default",
          basePolicyName: "Microsoft.DefaultV2",
          contentFilters: policyFilters(courtDocs),
        },
      },
      { dependsOn: [primaryProject] },
    );
  }
  // Azure permits one deployment operation at a time on the account.
  const reconDeploymentImportId =
    environmentName === "Test"
      ? `/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/primary-foundry/providers/Microsoft.CognitiveServices/accounts/${primaryImportName}/deployments/recon-test-gpt-6-luna`
      : `/subscriptions/00000000-0000-4000-8000-000000000002/resourceGroups/primary-foundry/providers/Microsoft.CognitiveServices/accounts/${primaryImportName}/deployments/recon-test-gpt-6-luna`;
  let previousPrimaryDeployment: pulumi.Resource | undefined;
  for (const definition of primaryDeployments) {
    if (
      environmentName !== "Production" &&
      "productionOnly" in definition &&
      definition.productionOnly
    ) {
      continue;
    }
    if (
      environmentName === "Production" &&
      "productionEnabled" in definition &&
      !definition.productionEnabled
    ) {
      continue;
    }
    const effective = {
      ...definition,
      ...(environmentName === "Production" && "production" in definition
        ? definition.production
        : {}),
    };
    const {
      name,
      skuName,
      capacity,
      modelName,
      modelVersion,
      raiPolicyName,
      upgrade,
    } = effective;
    previousPrimaryDeployment = new cognitiveservices.Deployment(
      `aimie3-${name}`,
      {
        accountName: primary.name,
        deploymentName: name,
        resourceGroupName: groups["primary-foundry"].name,
        sku: { name: skuName, capacity },
        properties: {
          model: {
            format: modelName.startsWith("claude-") ? "Anthropic" : "OpenAI",
            name: modelName,
            version: modelVersion,
          },
          versionUpgradeOption: upgrade,
          raiPolicyName,
        },
      },
      {
        dependsOn: [
          ...Object.values(policies),
          ...(previousPrimaryDeployment ? [previousPrimaryDeployment] : []),
        ],
        import:
          name === "recon-test-gpt-6-luna"
            ? reconDeploymentImportId
            : undefined,
        ignoreChanges: ["properties.currentCapacity"],
      },
    );
  }

  // The 2026-05-01 API exposes model-router routing modes, which the default
  // Azure Native deployment resource does not yet accept.
  const testRouterImportPrefix =
    `/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/primary-foundry/providers/Microsoft.CognitiveServices/accounts/${primaryImportName}/deployments`;
  for (const { name, capacity, mode, modelNames, upgrade } of [
    { name: "fast-tasks-model-router", capacity: 4624, mode: "cost", modelNames: ["gpt-5.6-luna"], upgrade: "NoAutoUpgrade" },
    { name: "utility-model-router", capacity: environmentName === "Production" ? 17494 : 12057,
      mode: environmentName === "Production" ? "quality" : "balanced",
      modelNames: ["gpt-5.6-sol", "gpt-5.6-terra"],
      upgrade: environmentName === "Production" ? "OnceNewDefaultVersionAvailable" : "NoAutoUpgrade" },
  ] as const) {
    previousPrimaryDeployment = new cognitiveservices20260501.Deployment(
      `aimie3-${name}`,
      {
        accountName: primary.name,
        deploymentName: name,
        resourceGroupName: groups["primary-foundry"].name,
        sku: { name: "GlobalStandard", capacity },
        properties: {
          model: {
            format: "OpenAI",
            name: "model-router",
            version: "2025-11-18",
          },
          routing: {
            mode,
            models: modelNames.map(modelName => ({format: "OpenAI", name: modelName, version: "2026-07-09"})),
          },
          versionUpgradeOption: upgrade,
          raiPolicyName: "SensitiveInfoLevel",
        },
      },
      {
        dependsOn: [
          ...Object.values(policies),
          ...(previousPrimaryDeployment ? [previousPrimaryDeployment] : []),
        ],
        import:
          environmentName === "Test"
            ? `${testRouterImportPrefix}/${name}`
            : undefined,
        ignoreChanges: ["properties.currentCapacity", "properties.deploymentState"],
      },
    );
  }

  const dataLoader = createAiAccount(
    "data-loader-foundry-account",
    dataLoaderNameOverride ?? pulumi.interpolate`data-loader-${suffix}`,
    groups["data-loader-foundry"],
    "centralus",
    "AIServices",
    environmentName,
    true,
  );
  disableDefenderForAi(
    "data-loader",
    dataLoader,
    groups["data-loader-foundry"],
  );
  for (const { name, modelName } of [
    { name: "pbl-query", modelName: "text-embedding-3-large" },
    { name: "pbl-partitioning", modelName: "text-embedding-3-small" },
  ] as const) {
    new cognitiveservices.Deployment(
      `data-loader-${name}`,
      {
        accountName: dataLoader.name,
        deploymentName: name,
        resourceGroupName: groups["data-loader-foundry"].name,
        sku: { name: "GlobalStandard", capacity: 1000 },
        properties: {
          model: { format: "OpenAI", name: modelName, version: "1" },
          versionUpgradeOption: "NoAutoUpgrade",
          raiPolicyName: "Microsoft.DefaultV2",
        },
      },
      { ignoreChanges: ["properties.currentCapacity"] },
    );
  }
  new cognitiveservices.Project("data-loader-project", {
    accountName: dataLoader.name,
    projectName: pulumi.interpolate`${dataLoader.name}-project`,
    resourceGroupName: groups["data-loader-foundry"].name,
    location: "centralus",
    identity: { type: "SystemAssigned" },
    properties: {
      description: "Default project created with the resource",
      displayName: pulumi.interpolate`${dataLoader.name}-project`,
    },
  });

  // Data Integrity's DI_ENDPOINT uses this multi-service account for Document Intelligence.
  const cognitive = createAiAccount(
    "cognitive-service",
    pulumi.interpolate`cog-svc-${suffix}`,
    groups["data-loader-foundry"],
    "eastus",
    "CognitiveServices",
    environmentName,
    true,
  );
  return { primary, dataLoader, cognitive };
}
