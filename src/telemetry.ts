import * as pulumi from "@pulumi/pulumi";
import {
  applicationinsights,
  operationalinsights,
  resources,
  web,
} from "@pulumi/azure-native";
import { armUniqueString } from "./naming";
import { serviceModules } from "./services";

export function createTelemetryAndPlans(
  groups: Record<string, resources.ResourceGroup>,
  environmentName: string,
  skuName: string,
  activeServices: ReadonlyArray<(typeof serviceModules)[number]>,
  keepLegacyPortalWebApp: boolean,
) {
  const definitions = activeServices.map(
    (service) => service.telemetryDefinition,
  );
  const workspaces: Record<string, operationalinsights.Workspace> = {};
  const insights: Record<string, applicationinsights.Component> = {};
  const plans: Record<string, web.AppServicePlan> = {};
  const sku =
    skuName === "B1"
      ? { name: "B1", tier: "Basic", size: "B1", family: "B" }
      : skuName === "B2"
        ? { name: "B2", tier: "Basic", size: "B2", family: "B" }
        : { name: "P0v3", tier: "Premium0V3", size: "P0v3", family: "Pv3" };
  for (const definition of definitions) {
    const {
      key,
      groupName,
      workspacePrefix,
      insightPrefix,
      telemetryLocation,
      insightTagged,
    } = definition;
    const insightOverrides =
      environmentName === "Test" && "testInsightOverrides" in definition
        ? definition.testInsightOverrides
        : environmentName === "Production" &&
            "productionInsightOverrides" in definition
          ? definition.productionInsightOverrides
          : {};
    const group = groups[groupName];
    const suffix = armUniqueString(groupName, group.id).apply((value) =>
      value.slice(0, 8),
    );
    workspaces[key] = new operationalinsights.Workspace(`${key}-workspace`, {
      workspaceName: pulumi.interpolate`${workspacePrefix}${suffix}`,
      resourceGroupName: group.name,
      location: telemetryLocation,
      sku: { name: "PerGB2018" },
      retentionInDays: 30,
      features: { enableLogAccessUsingOnlyResourcePermissions: true },
      workspaceCapping: { dailyQuotaGb: -1 },
      publicNetworkAccessForIngestion: "Enabled",
      publicNetworkAccessForQuery: "Enabled",
    });
    insights[key] = new applicationinsights.Component(`${key}-app-insights`, {
      resourceName: pulumi.interpolate`${insightPrefix}${suffix}`,
      resourceGroupName: group.name,
      location: telemetryLocation,
      kind: "web",
      tags: insightTagged ? { Environment: environmentName } : undefined,
      applicationType: "web",
      flowType: "Redfield",
      requestSource: "IbizaWebAppExtensionCreate",
      retentionInDays: 90,
      workspaceResourceId: workspaces[key].id,
      ingestionMode: "LogAnalytics",
      publicNetworkAccessForIngestion: "Enabled",
      publicNetworkAccessForQuery: "Enabled",
      disableLocalAuth: false,
      ...insightOverrides,
    });
    if (!("planPrefix" in definition) || !keepLegacyPortalWebApp) continue;
    const {
      planPrefix,
      planLocation,
      capacity,
      maxWorkers,
      workerCount,
      reserved,
      planTagged,
    } = definition;
    const planOverrides =
      environmentName === "Production"
        ? definition.productionPlanOverrides
        : {};
    plans[key] = new web.AppServicePlan(
      `${key}-plan`,
      {
        name: pulumi.interpolate`${planPrefix}${suffix}`,
        resourceGroupName: group.name,
        location: planLocation,
        tags: planTagged ? { Environment: environmentName } : undefined,
        sku: { ...sku, capacity },
        kind: "linux",
        perSiteScaling: false,
        elasticScaleEnabled: false,
        maximumElasticWorkerCount: maxWorkers,
        isSpot: false,
        reserved,
        isXenon: false,
        hyperV: false,
        targetWorkerCount: workerCount,
        targetWorkerSizeId: 0,
        zoneRedundant: false,
        asyncScalingEnabled: false,
        ...planOverrides,
      },
      { ignoreChanges: ["isCustomMode"] },
    );
  }
  return { workspaces, insights, plans };
}
