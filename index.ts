import * as pulumi from "@pulumi/pulumi";
import { createAksNorthNetwork } from "./src/aksNorthNetwork";
import { createAksPlatform } from "./src/aksPlatform";
import { configureTestAksMarkdownTlsDns } from "./src/aksTlsDns";
import { createCosmos } from "./src/cosmos";
import { createEventHubs } from "./src/eventHubs";
import { configureFileOperationsDeploymentAccess } from "./src/fileOperationsDeploymentAccess";
import { createFoundation } from "./src/foundation";
import { createFoundry } from "./src/foundry";
import { configureGrafana } from "./src/grafana";
import { createResourceGroups } from "./src/groups";
import { createKeyVaults } from "./src/keyVaults";
import { createPortalDelivery } from "./src/portalDelivery";
import { configureProductionSharedDataStorageAccess } from "./src/productionSharedDataStorageAccess";
import { getServiceModules } from "./src/services";
import type { ServiceContext } from "./src/services/context";
import { createSharedPrivateEndpoints } from "./src/sharedEndpoints";
import { configureSharedStorageApplicationAccess } from "./src/sharedStorageApplicationAccess";
import { createSharedStorageNorthCentral } from "./src/sharedStorageNorthCentral";
import { createTelemetryAndPlans } from "./src/telemetry";
import { createVideoIndexer } from "./src/videoIndexer";

const config = new pulumi.Config();
const environmentName = config.require("environmentName");
if (!(config.getBoolean("environmentEnabled") ?? environmentName !== "Test")) {
  throw new Error(
    "This stack is disabled. Configure a dedicated subscription and set environmentEnabled=true before deploying it.",
  );
}
const skuName = config.require("skuName");
const keepLegacyPortalWebApp =
  config.getBoolean("keepLegacyPortalWebApp") ?? false;
if (keepLegacyPortalWebApp)
  throw new Error(
    "Legacy portal storage has been retired; keepLegacyPortalWebApp must be false",
  );
if (
  environmentName === "Production" &&
  !keepLegacyPortalWebApp &&
  !config.getBoolean("productionApexFrontDoor")
) {
  throw new Error(
    "Production apex must target Front Door before retiring the Web App",
  );
}
const subscriptionId = pulumi.interpolate`/subscriptions/${new pulumi.Config("azure-native").require("subscriptionId")}`;
export const fileOperationsDeploymentReaderAssignmentIds =
  configureFileOperationsDeploymentAccess(environmentName).map(
    (assignment) => assignment.id,
  );
configureTestAksMarkdownTlsDns(subscriptionId, environmentName);
if (skuName !== "B1" && skuName !== "B2" && skuName !== "P0v3") {
  throw new Error(`Unsupported skuName: ${skuName}`);
}

const serviceModules = getServiceModules(environmentName);

const foundation = createFoundation();
const groups = createResourceGroups(environmentName);
for (const service of serviceModules) {
  service.createGroup(groups, environmentName);
}
const subnets: ServiceContext["subnets"] = {};
const storageAccounts: ServiceContext["accounts"] = {};
const aksNorthNetwork = createAksNorthNetwork(foundation, environmentName);
const sharedStorageNorthCentral = createSharedStorageNorthCentral(
  config.getBoolean("stageSharedStorageNorthCentral") ?? false,
  environmentName,
  subscriptionId,
  foundation,
  aksNorthNetwork,
  config.getBoolean("stageAimieStorageNorthCentral") ?? false,
);
if (!sharedStorageNorthCentral?.account)
  throw new Error(
    "Consolidated storage is required after legacy account retirement",
  );
subnets["aks/private-endpoints"] = sharedStorageNorthCentral.subnet;
const cosmos = createCosmos(
  groups["shared-dbs"],
  subscriptionId,
  environmentName,
);
const foundry = createFoundry(groups, subscriptionId, environmentName);
const eventHubs = createEventHubs(
  foundation,
  groups,
  subnets,
  subscriptionId,
  environmentName,
);
createSharedPrivateEndpoints(
  foundation,
  groups,
  subnets,
  cosmos,
  foundry,
  subscriptionId,
  environmentName,
);
const keyVaults = createKeyVaults(foundation, groups, subnets, environmentName);
const videoIndexer = createVideoIndexer(
  foundation,
  groups,
  sharedStorageNorthCentral.subnet,
  sharedStorageNorthCentral.account,
  subscriptionId,
  environmentName,
);
if (sharedStorageNorthCentral) {
  groups["shared-storage-northcentral"] = sharedStorageNorthCentral.group;
  if (sharedStorageNorthCentral.account)
    storageAccounts.sharedData = sharedStorageNorthCentral.account;
  storageAccounts.sharedAimie = sharedStorageNorthCentral.aimieAccount;
  configureSharedStorageApplicationAccess(
    environmentName,
    subscriptionId,
    sharedStorageNorthCentral.account,
    sharedStorageNorthCentral.aimieAccount,
    sharedStorageNorthCentral.aimieAgents,
  );
  if (sharedStorageNorthCentral.account) {
    configureProductionSharedDataStorageAccess(
      sharedStorageNorthCentral.account,
      sharedStorageNorthCentral.group,
      subscriptionId,
      environmentName,
    );
  }
}
const aksPlatform = createAksPlatform(
  environmentName,
  subscriptionId,
  aksNorthNetwork,
);
if (!aksPlatform)
  throw new Error("AKS platform is required for portal delivery");
const portalDelivery = createPortalDelivery(
  environmentName,
  subscriptionId,
  groups["probonolaw-portal"],
  aksPlatform,
  keepLegacyPortalWebApp,
);
configureGrafana(environmentName, subscriptionId, aksPlatform);
if (aksPlatform)
  subnets[environmentName === "Test" ? "aks/test-north" : "aks/prod-north"] =
    aksPlatform.subnet;
const telemetry = createTelemetryAndPlans(
  groups,
  environmentName,
  skuName,
  serviceModules,
  keepLegacyPortalWebApp,
);
const apps: ServiceContext["apps"] = {};
const serviceContext: ServiceContext = {
  environmentName,
  keepLegacyPortalWebApp,
  subscriptionId,
  foundation,
  subnets,
  groups,
  accounts: storageAccounts,
  telemetry,
  apps,
  videoIndexer,
};
const additionalOutputs: Record<string, pulumi.Input<string>> = {};
for (const service of serviceModules) {
  if ("createAdditionalResources" in service) {
    Object.assign(
      additionalOutputs,
      service.createAdditionalResources(serviceContext),
    );
  }
}
for (const name of ["notificationWebPubSubId", "documentIngressId"]) {
  if (!(name in additionalOutputs)) {
    throw new Error(`Missing service output: ${name}`);
  }
}
for (const service of serviceModules)
  if ("createAccess" in service) service.createAccess(serviceContext);

export const applicationVnetId = aksNorthNetwork.vnet.id;
export const privateEndpointSubnetId = sharedStorageNorthCentral.subnet.id;
export const resourceGroupIds = Object.fromEntries(
  Object.entries(groups).map(([key, value]) => [key, value.id]),
);
export const storageAccountIds = Object.fromEntries(
  Object.entries(storageAccounts).map(([key, value]) => [key, value.id]),
);
export const sharedDataStorageAccountName =
  sharedStorageNorthCentral?.account?.name;
export const sharedAimieStorageAccountName =
  sharedStorageNorthCentral?.aimieAccount.name;
export const sharedDataStorageSubnetId = sharedStorageNorthCentral?.subnet.id;
export const cosmosAccountId = cosmos.serverless.account.id;
export const foundryAccountIds = {
  primary: foundry.primary.id,
  dataLoader: foundry.dataLoader.id,
  cognitive: foundry.cognitive.id,
};
export const eventHubNamespaceIds = {
  consolidated: eventHubs.consolidated.id,
};
export const consolidatedEventHub = {
  name: eventHubs.consolidated.name,
  fullyQualifiedNamespace: pulumi.interpolate`${eventHubs.consolidated.name}.servicebus.windows.net`,
};
export const keyVaultIds = {
  customer: keyVaults.customer.id,
  onboarding: keyVaults.onboarding.id,
};
export const videoIndexerId = videoIndexer.account.id;
export const workspaceIds = Object.fromEntries(
  Object.entries(telemetry.workspaces).map(([key, value]) => [key, value.id]),
);
export const appIds = Object.fromEntries(
  Object.entries(apps).map(([key, value]) => [key, value.id]),
);
export const documentIngressId = additionalOutputs.documentIngressId;
export const notificationWebPubSubId =
  additionalOutputs.notificationWebPubSubId;
export const aksClusterId = aksPlatform?.cluster.id;
export const aksRegistryId = aksPlatform?.registry.id;
export const aksSecretsVaultId = aksPlatform?.vault.id;
export const portalStaticSiteId = portalDelivery.staticSite.id;
export const portalStaticSiteHostname =
  portalDelivery.staticSite.defaultHostname;
export const portalFrontDoorId = portalDelivery.profile.id;
export const portalFrontDoorGuid = portalDelivery.profile.frontDoorId;
export const portalFrontDoorHostname = portalDelivery.endpoint.hostName;
export const portalApiPublicIp = portalDelivery.apiPublicIp.ipAddress;
export const portalApiPublicIpName = portalDelivery.apiPublicIp.name;
export const portalApiOriginHostname = portalDelivery.apiOriginHostName;
export const portalTestDomainValidationToken =
  portalDelivery.testCustomDomain?.validationProperties.apply(
    (properties) => properties?.validationToken,
  );
export const portalProductionDomainValidationToken =
  portalDelivery.productionCustomDomain?.validationProperties.apply(
    (properties) => properties?.validationToken,
  );
export const portalProductionWwwDomainValidationToken =
  portalDelivery.productionWwwCustomDomain?.validationProperties.apply(
    (properties) => properties?.validationToken,
  );
export const portalProductionDnsNameServers =
  portalDelivery.productionDnsZone?.nameServers;
