const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pulumi = require("@pulumi/pulumi");
const yaml = require("yaml");

const environmentName = process.env.GRAPH_ENVIRONMENT_NAME ?? "Test";
const stackName = environmentName === "Test" ? "test" : "prod";
const stackConfig = yaml.parse(
  fs.readFileSync(path.join(__dirname, `../Pulumi.${stackName}.yaml`), "utf8"),
).config;
const subscriptionId =
  process.env.GRAPH_SUBSCRIPTION_ID ??
  stackConfig["azure-native:subscriptionId"];
const skuName =
  process.env.GRAPH_SKU_NAME ??
  stackConfig["probonolaw-infrastructure:skuName"];
const cosmosNorthCentral =
  (process.env.GRAPH_COSMOS_NORTH_CENTRAL ??
    String(
      stackConfig["probonolaw-infrastructure:cosmosNorthCentral"] ?? false,
    )) === "true";
const cosmosProvisioned =
  cosmosNorthCentral ||
  String(
    stackConfig["probonolaw-infrastructure:cosmosProvisioned"] ?? false,
  ) === "true";
const keepLegacyPortalWebApp =
  (process.env.GRAPH_KEEP_LEGACY_PORTAL_WEB_APP ??
    String(
      stackConfig["probonolaw-infrastructure:keepLegacyPortalWebApp"] ?? true,
    )) === "true";
const productionApexFrontDoor =
  (process.env.GRAPH_PRODUCTION_APEX_FRONT_DOOR ??
    String(
      stackConfig["probonolaw-infrastructure:productionApexFrontDoor"] ?? false,
    )) === "true";
const stageSharedStorageNorthCentral =
  (process.env.GRAPH_STAGE_SHARED_STORAGE_NORTH_CENTRAL ??
    String(
      stackConfig["probonolaw-infrastructure:stageSharedStorageNorthCentral"] ??
        false,
    )) === "true";
const stageAimieStorageNorthCentral =
  stageSharedStorageNorthCentral ||
  (process.env.GRAPH_STAGE_AIMIE_STORAGE_NORTH_CENTRAL ??
    String(
      stackConfig["probonolaw-infrastructure:stageAimieStorageNorthCentral"] ??
        false,
    )) === "true";
const stagedStorageCount =
  Number(stageSharedStorageNorthCentral) +
  Number(stageAimieStorageNorthCentral);
process.env.PULUMI_CONFIG = JSON.stringify({
  "probonolaw-infrastructure:environmentName": environmentName,
  "probonolaw-infrastructure:skuName": skuName,
  "probonolaw-infrastructure:cosmosNorthCentral": String(cosmosNorthCentral),
  "probonolaw-infrastructure:cosmosProvisioned": String(cosmosProvisioned),
  "probonolaw-infrastructure:keepLegacyPortalWebApp": String(
    keepLegacyPortalWebApp,
  ),
  "probonolaw-infrastructure:apiOriginDnsZone":
    stackConfig["probonolaw-infrastructure:apiOriginDnsZone"],
  "probonolaw-infrastructure:productionLegacyApexIp":
    stackConfig["probonolaw-infrastructure:productionLegacyApexIp"],
  "probonolaw-infrastructure:productionApexFrontDoor": String(
    productionApexFrontDoor,
  ),
  "probonolaw-infrastructure:stageSharedStorageNorthCentral": String(
    stageSharedStorageNorthCentral,
  ),
  "probonolaw-infrastructure:stageAimieStorageNorthCentral": String(
    stageAimieStorageNorthCentral,
  ),
  "probonolaw-infrastructure:aksOperatorIpCidr":
    stackConfig["probonolaw-infrastructure:aksOperatorIpCidr"],
  "probonolaw-infrastructure:aksCertificateOperatorPrincipalId":
    stackConfig["probonolaw-infrastructure:aksCertificateOperatorPrincipalId"],
  "probonolaw-infrastructure:aksNodeMinCount": String(
    stackConfig["probonolaw-infrastructure:aksNodeMinCount"] ?? 5,
  ),
  "probonolaw-infrastructure:aksNodeMaxCount": String(
    stackConfig["probonolaw-infrastructure:aksNodeMaxCount"] ?? 10,
  ),
  "probonolaw-infrastructure:aksKubernetesVersion":
    stackConfig["probonolaw-infrastructure:aksKubernetesVersion"] ?? "1.35",
  "azure-native:subscriptionId": subscriptionId,
});

const resources = [];
pulumi.runtime.setMocks(
  {
    newResource({ type, name, inputs, id }) {
      resources.push({ type, name, inputs, id });
      const physicalName =
        inputs.name ??
        inputs.projectName ??
        inputs.deploymentName ??
        inputs.raiPolicyName ??
        inputs.consumerGroupName ??
        inputs.eventHubName ??
        inputs.databaseName ??
        inputs.authorizationRuleName ??
        inputs.networkRuleSetName ??
        inputs.privateDnsZoneGroupName ??
        inputs.relativeRecordSetName ??
        inputs.zoneName ??
        inputs.virtualNetworkLinkName ??
        inputs.containerName ??
        inputs.shareName ??
        inputs.blobServicesName ??
        inputs.fileServicesName ??
        inputs.queueServiceName ??
        inputs.tableServiceName ??
        inputs.privateEndpointName ??
        inputs.publicIpAddressName ??
        inputs.profileName ??
        inputs.endpointName ??
        inputs.originGroupName ??
        inputs.originName ??
        inputs.routeName ??
        inputs.subnetName ??
        inputs.privateZoneName ??
        inputs.connectionName ??
        inputs.resourceName ??
        inputs.vaultName ??
        inputs.registryName ??
        inputs.accountName ??
        inputs.namespaceName ??
        inputs.virtualNetworkName ??
        inputs.workspaceName ??
        inputs.resourceGroupName ??
        name;
      const state = { ...inputs, name: physicalName };
      if (type === "azure-native:resources:DeploymentAtSubscriptionScope") {
        state.properties = {
          outputs: { result: { value: "1234567890abcdef" } },
        };
      }
      if (type === "azure-native:web:WebApp") {
        state.identity = {
          ...inputs.identity,
          principalId: `${name}-principal`,
        };
      }
      if (type === "azure-native:web:StaticSite") {
        state.defaultHostname = `${name}.azurestaticapps.net`;
      }
      if (type === "azure-native:cdn:AFDEndpoint") {
        state.hostName = `${name}.azurefd.net`;
      }
      if (type === "azure-native:cdn:AFDCustomDomain") {
        state.validationProperties = {
          validationToken: "mock-validation-token",
        };
      }
      if (type === "azure-native:cdn:Profile") {
        state.frontDoorId = `${name}-guid`;
      }
      if (type === "azure-native:network:PublicIPAddress") {
        state.ipAddress = "203.0.113.10";
      }
      if (type === "azure-native:managedidentity:UserAssignedIdentity") {
        state.principalId = `${name}-principal`;
      }
      if (type === "azure-native:dashboard:Grafana") {
        state.identity = {
          ...inputs.identity,
          principalId: `${name}-principal`,
        };
      }
      if (type === "azure-native:containerservice:ManagedCluster") {
        state.oidcIssuerProfile = {
          ...inputs.oidcIssuerProfile,
          issuerURL: `https://${name}.oidc.example.invalid/`,
        };
        state.identityProfile = {
          kubeletidentity: { objectId: `${name}-kubelet-principal` },
        };
        state.ingressProfile = {
          webAppRouting: {
            ...inputs.ingressProfile?.webAppRouting,
            identity: { objectId: `${name}-routing-principal` },
          },
        };
      }
      return { id: `/mock/${name}`, state };
    },
    call({ token, inputs }) {
      if (token.includes("getClientConfig")) {
        return { subscriptionId: "00000000-0000-0000-0000-000000000000" };
      }
      if (token.includes("getUserAssignedIdentity")) {
        return { principalId: `${inputs.resourceName}-principal` };
      }
      if (token.includes("getManagedCluster")) {
        throw new Error("Retired Test AKS must not be referenced");
      }
      return {};
    },
  },
  "probonolaw-infrastructure",
  environmentName === "Test" ? "test" : "prod",
  false,
);

async function main() {
  const { validateApiOriginDnsZone } = require("../dist/src/portalDelivery.js");
  assert.equal(validateApiOriginDnsZone("probono-law.com"), "probono-law.com");
  for (const invalidZone of [
    "api..example.com",
    "api.-example.com",
    "-api.example.com",
    "a".repeat(64) + ".example.com",
    "a".repeat(63) +
      "." +
      "b".repeat(63) +
      "." +
      "c".repeat(63) +
      "." +
      "d".repeat(50),
  ]) {
    assert.throws(() => validateApiOriginDnsZone(invalidZone));
  }
  const program = require("../dist/index.js");
  assert(program.notificationWebPubSubId, "Notification Web PubSub output");
  assert(program.documentIngressId, "Document ingress output");
  await Promise.all(
    Object.values(program).map((value) => pulumi.output(value).promise()),
  );
  await pulumi.runtime.waitForRPCs();
  const counts = new Map();
  const deploymentNames = new Set();
  for (const resource of resources) {
    if (
      resource.type === "azure-native:resources:DeploymentAtSubscriptionScope"
    ) {
      const deploymentName = resource.inputs.deploymentName;
      assert(
        !deploymentNames.has(deploymentName),
        `Duplicate ARM deployment name: ${deploymentName}`,
      );
      deploymentNames.add(deploymentName);
    }
    counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  }
  const test = environmentName === "Test";
  const productionSharedData = !test && stageSharedStorageNorthCentral;
  const expected = {
    "azure-native:resources:ResourceGroup":
      (test ? 20 : 27) + (stagedStorageCount ? 1 : 0),
    "azure-native:network:VirtualNetwork": 1,
    "azure-native:network:Subnet": 1 + (stagedStorageCount ? 1 : 0),
    "azure-native:network:VirtualNetworkPeering": 0,
    "azure-native:network:PublicIPAddress": 1,
    "azure-native:network:PrivateEndpoint": 17,
    "azure-native:network:PrivateDnsZoneGroup": 17,
    "azure-native:privatedns:VirtualNetworkLink": 15,
    "azure-native:containerregistry:Registry": test ? 0 : 1,
    "azure-native:containerservice:ManagedCluster": 1,
    "azure-native:keyvault:Vault": 4,
    "azure-native:managedidentity:UserAssignedIdentity": 2,
    "azure-native:managedidentity:FederatedIdentityCredential": test ? 10 : 0,
    "azure-native:authorization:ManagementLockByScope": 2,
    "azure-native:storage:StorageAccount": stagedStorageCount,
    "azure-native:storage:BlobServiceProperties": stagedStorageCount,
    "azure-native:storage:FileServiceProperties": stagedStorageCount,
    "azure-native:storage:BlobContainer":
      (stageSharedStorageNorthCentral ? 3 : 0) +
      Number(stageAimieStorageNorthCentral) +
      (stageSharedStorageNorthCentral ? (test ? 12 : 14) : 0),
    "azure-native:storage:Table": stageSharedStorageNorthCentral
      ? test
        ? 1
        : 7
      : 0,
    "azure-native:web:AppServicePlan": keepLegacyPortalWebApp ? 1 : 0,
    "azure-native:web:WebApp": keepLegacyPortalWebApp ? 1 : 0,
    "azure-native:web:StaticSite": 1,
    "azure-native:cdn:Profile": 1,
    "azure-native:cdn:AFDEndpoint": 1,
    "azure-native:cdn:AFDOriginGroup": 2,
    "azure-native:cdn:AFDOrigin": 2,
    "azure-native:cdn:Route": 2,
    "azure-native:cdn:AFDCustomDomain": test ? 1 : 2,
    "azure-native:dns:Zone": test ? 0 : 1,
    "azure-native:dns:RecordSet": test ? 0 : keepLegacyPortalWebApp ? 22 : 21,
    "azure-native:operationalinsights:Workspace": test ? 6 : 10,
    "azure-native:applicationinsights:Component": test ? 6 : 9,
    "azure-native:authorization:RoleAssignment": 47,
    "azure-native:dashboard:Grafana": test ? 0 : 1,
    "azure-native:authorization:RoleDefinition": 2,
    "azure-native:cosmosdb:DatabaseAccount": 1,
    "azure-native:cosmosdb:SqlResourceSqlDatabase": 1,
    "azure-native:cosmosdb:SqlResourceSqlContainer": test ? 8 : 9,
    "azure-native:cosmosdb:SqlResourceSqlRoleDefinition": 1,
    "azure-native:cosmosdb:SqlResourceSqlRoleAssignment": 1,
    "azure-native:resources:Deployment": 3 + (cosmosNorthCentral ? 9 : 0),
    "azure-native:resources:DeploymentAtSubscriptionScope": test ? 55 : 65,
    "azure-native:web:Connection": 0,
  };
  for (const [type, count] of Object.entries(expected)) {
    assert.equal(counts.get(type) ?? 0, count, `${type} resource count`);
  }
  assert(!("aimieNotification" in program.storageAccountIds));
  assert(
    !resources.some(
      ({ name }) =>
        name.startsWith("aimie-notification-storage") ||
        name.startsWith("aimieNotification-storage-"),
    ),
    "Notification storage and its endpoints are retired",
  );
  for (const name of [
    "aimie-notification-webpubsub",
    "aimie-notification-webpubsub-pe",
    "aimieNotification-workspace",
    "aimieNotification-app-insights",
  ]) {
    assert(
      resources.some((resource) => resource.name === name),
      `${name} remains`,
    );
  }
  const pubSubDeployment = resources.find(
    ({ name }) => name === "aimie-notification-webpubsub",
  );
  const pubSubParameters = pubSubDeployment.inputs.properties.parameters;
  assert.equal(
    pubSubParameters.privateEndpointConnectionName.value,
    `${pubSubParameters.name.value}.${environmentName === "Test" ? "00000000-0000-4000-8000-000000000011" : "00000000-0000-4000-8000-000000000012"}`,
    "Web PubSub ACL must name the retained North Central US connection",
  );
  const pubSubAcl =
    pubSubDeployment.inputs.properties.template.resources[0].properties
      .networkACLs;
  assert.equal(pubSubAcl.defaultAction, "Deny");
  assert.deepEqual(pubSubAcl.privateEndpoints, [
    {
      name: "[parameters('privateEndpointConnectionName')]",
      allow: ["ServerConnection", "ClientConnection", "RESTAPI", "Trace"],
    },
  ]);
  const sharedData = resources.find(
    ({ name }) => name === "shared-data-storage",
  );
  const sharedAimie = resources.find(
    ({ name }) => name === "shared-aimie-storage",
  );
  assert.equal(!!sharedData, stageSharedStorageNorthCentral);
  assert.equal(!!sharedAimie, stageAimieStorageNorthCentral);
  if (stageAimieStorageNorthCentral) {
    assert.equal(sharedAimie.inputs.allowSharedKeyAccess, false);
    assert.equal(sharedAimie.inputs.publicNetworkAccess, "Disabled");
    assert.equal(sharedAimie.inputs.location, "northcentralus");
    const agentsOwner = resources.find(
      ({ name }) => name === "shared-storage-aimie-agents-owner",
    );
    assert.equal(agentsOwner.inputs.scope, "/mock/shared-aimie-storage-agents");
    assert.equal(
      agentsOwner.inputs.principalId,
      test
        ? "aimie-service-test-workload-principal"
        : "aimie-service-workload-prod-principal",
    );
    assert.equal(
      agentsOwner.inputs.roleDefinitionId,
      `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/b7e6dc6d-f1e8-4753-8033-0f276bb0955b`,
    );
    for (const [role, id] of [
      ["blob-owner", "b7e6dc6d-f1e8-4753-8033-0f276bb0955b"],
      ["queue-contributor", "974c5e8b-45b9-4653-ba55-5f855dd0fb88"],
      ["table-contributor", "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3"],
    ]) {
      const grant = resources.find(
        ({ name }) => name === `shared-storage-aimie-${role}`,
      );
      assert.equal(grant.inputs.scope, "/mock/shared-aimie-storage");
      assert.equal(
        grant.inputs.principalId,
        test
          ? "aimie-service-test-workload-principal"
          : "aimie-service-workload-prod-principal",
      );
      assert.equal(
        grant.inputs.roleDefinitionId,
        `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${id}`,
      );
    }
    for (const service of ["blob", "queue", "table"]) {
      const endpoint = resources.find(
        ({ name }) => name === `sharedAimieNorthCentral-storage-${service}-pe`,
      );
      assert.equal(
        endpoint.inputs.subnet.id,
        "/mock/shared-storage-northcentral-subnet",
      );
      assert.equal(
        endpoint.inputs.privateLinkServiceConnections[0].privateLinkServiceId,
        "/mock/shared-aimie-storage",
      );
    }
  }
  if (stageSharedStorageNorthCentral) {
    assert.equal(sharedData.inputs.location, "northcentralus");
    assert.equal(sharedData.inputs.sku.name, "Standard_RAGRS");
    // Video Indexer uses the trusted Azure services path in both environments.
    assert.equal(sharedData.inputs.publicNetworkAccess, "Enabled");
    assert.equal(sharedData.inputs.networkRuleSet.defaultAction, "Deny");
    assert.equal(sharedData.inputs.networkRuleSet.bypass, "AzureServices");
    assert.deepEqual(sharedData.inputs.networkRuleSet.ipRules ?? [], []);
    assert.deepEqual(
      sharedData.inputs.networkRuleSet.virtualNetworkRules ?? [],
      [],
    );
    assert.equal(sharedData.inputs.allowBlobPublicAccess, false);
    assert.equal(sharedData.inputs.allowSharedKeyAccess, false);
    assert.equal(sharedData.inputs.defaultToOAuthAuthentication, true);
    assert.match(sharedData.inputs.accountName, /^[a-z0-9]{3,24}$/);
    if (stageSharedStorageNorthCentral) {
      const plan = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "../deploy/storage-migration/test.json"),
          "utf8",
        ),
      );
      const containers = resources.filter(({ name }) =>
        name.startsWith("shared-data-container-"),
      );
      assert.deepEqual(
        containers.map(({ inputs }) => inputs.containerName).sort(),
        [
          ...(test ? [] : plan.sources.portal.containers),
          ...plan.sources.dataAutomation.containers,
        ].sort(),
      );
      for (const container of containers) {
        assert.equal(
          container.inputs.accountName,
          sharedData.inputs.accountName,
        );
        assert.equal(container.inputs.publicAccess, "None");
      }
      const tables = resources.filter(({ name }) =>
        name.startsWith("shared-data-table-"),
      );
      assert.deepEqual(
        tables.map(({ inputs }) => inputs.tableName).sort(),
        [
          ...(test ? [] : plan.sources.portal.tables),
          "IngestionProgress",
        ].sort(),
      );
      const grants = resources.filter(({ name }) =>
        name.startsWith("shared-data-access-"),
      );
      assert.equal(grants.length, test ? 13 : 21);
      const portal = grants.filter(({ name }) =>
        name.startsWith("shared-data-access-portal-"),
      );
      assert.equal(portal.length, test ? 0 : 8);
      for (const grant of portal) {
        assert.equal(
          grant.inputs.principalId,
          "probonolaw-ui-runtime-prod-principal",
        );
        assert.match(
          grant.inputs.scope,
          /^\/mock\/shared-data-(container|table)-/,
        );
      }
      for (const [service, roleId] of [
        ["blob", "ba92f5b4-2d11-453d-a403-e96b0029c9fe"],
        ["queue", "974c5e8b-45b9-4653-ba55-5f855dd0fb88"],
        ["table", "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3"],
      ]) {
        const grant = grants.find(
          ({ name }) => name === `shared-data-access-files-${service}`,
        );
        assert.equal(grant.inputs.scope, "/mock/shared-data-storage");
        assert.equal(
          grant.inputs.principalId,
          `file-operations-${test ? "test" : "prod"}-workload-principal`,
        );
        assert.equal(
          grant.inputs.roleDefinitionId,
          `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
        );
      }
      const emailReader = grants.find(
        ({ name }) => name === "shared-data-access-email-results-reader",
      );
      assert.equal(
        emailReader.inputs.scope,
        "/mock/shared-data-container-aimie-operations-results",
      );
      assert.equal(
        emailReader.inputs.principalId,
        `email-operations-${test ? "test" : "prod"}-workload-principal`,
      );
      assert.match(
        emailReader.inputs.roleDefinitionId,
        /\/2a2b9908-6ea1-4ae2-8e65-a410df84e7d1$/,
      );
      const videoGrant = resources.find(
        ({ name }) => name === "video-indexer-v2-storage-contributor",
      );
      assert.equal(
        videoGrant.inputs.principalId,
        "video-indexer-v2-identity-principal",
      );
      assert.equal(videoGrant.inputs.scope, "/mock/shared-data-storage");
    } else {
      assert(
        !resources.some(({ name }) => name.startsWith("shared-data-access-")),
      );
    }
    const subnet = resources.find(
      ({ name }) => name === "shared-storage-northcentral-subnet",
    );
    assert.equal(subnet.inputs.virtualNetworkName, "aks-northcentral");
    assert.equal(subnet.inputs.addressPrefix, "172.28.243.128/25");
    assert(
      !resources.some(
        ({ name }) => name === "sharedDataNorthCentral-storage-file-pe",
      ),
    );
    for (const service of ["blob", "queue", "table"]) {
      const endpoint = resources.find(
        ({ name }) => name === `sharedDataNorthCentral-storage-${service}-pe`,
      );
      assert.equal(endpoint.inputs.location, "northcentralus");
      assert.equal(
        endpoint.inputs.subnet.id,
        "/mock/shared-storage-northcentral-subnet",
      );
      assert.equal(
        endpoint.inputs.privateLinkServiceConnections[0].privateLinkServiceId,
        "/mock/shared-data-storage",
      );
      const dns = resources.find(
        ({ name }) =>
          name === `sharedDataNorthCentral-storage-${service}-pe-dns`,
      );
      assert.equal(
        dns.inputs.privateDnsZoneConfigs[0].name,
        `privatelink.${service}.core.windows.net`,
      );
    }
    assert.notEqual(
      sharedAimie.inputs.accountName,
      sharedData.inputs.accountName,
    );
    assert.equal(sharedAimie.inputs.location, "northcentralus");
    assert.equal(sharedAimie.inputs.sku.name, "Standard_RAGRS");
    assert.equal(sharedAimie.inputs.networkRuleSet.defaultAction, "Deny");
    assert.equal(sharedAimie.inputs.allowBlobPublicAccess, false);
    assert.equal(sharedAimie.inputs.allowSharedKeyAccess, false);
    assert.equal(sharedAimie.inputs.publicNetworkAccess, "Disabled");
    assert.match(sharedAimie.inputs.accountName, /^[a-z0-9]{3,24}$/);
    if (test) {
      const portalGrants = resources.filter(({ name }) =>
        name.startsWith("shared-storage-portal-"),
      );
      assert.equal(portalGrants.length, 8);
      for (const grant of portalGrants) {
        assert.equal(
          grant.inputs.principalId,
          "00000000-0000-4000-8000-000000000013",
        );
        assert.match(
          grant.inputs.scope,
          /^\/mock\/shared-data-storage\/(blobServices\/default\/containers|tableServices\/default\/tables)\/[^/]+$/,
        );
      }
    }
    assert.equal(
      resources.find(({ name }) => name === "shared-aimie-storage-agents")
        .inputs.accountName,
      sharedAimie.inputs.accountName,
    );
    for (const service of ["blob", "queue", "table"]) {
      const endpoint = resources.find(
        ({ name }) => name === `sharedAimieNorthCentral-storage-${service}-pe`,
      );
      assert.equal(endpoint.inputs.location, "northcentralus");
      assert.equal(
        endpoint.inputs.subnet.id,
        "/mock/shared-storage-northcentral-subnet",
      );
      assert.equal(
        endpoint.inputs.privateLinkServiceConnections[0].privateLinkServiceId,
        "/mock/shared-aimie-storage",
      );
      assert.equal(
        resources.find(
          ({ name }) =>
            name === `sharedAimieNorthCentral-storage-${service}-pe-dns`,
        ).inputs.privateDnsZoneConfigs[0].name,
        `privatelink.${service}.core.windows.net`,
      );
    }
    for (const key of ["sharedData", "sharedAimie"]) {
      assert(
        key in program.storageAccountIds,
        `${key} is the active consolidated storage`,
      );
    }
    const videoIndexer = resources.find(
      ({ name }) => name === "video-indexer-v2-account",
    );
    assert.equal(
      videoIndexer.inputs.storageServices.resourceId,
      "/mock/shared-data-storage",
      "Video Indexer uses consolidated North Central US storage",
    );
  }
  const deliveryName = resources.find(
    ({ name }) => name === "arm-name-uniqueString-portal-delivery",
  );
  assert(deliveryName, "Subscription-specific portal name calculation");
  assert.equal(
    deliveryName.inputs.properties.parameters.value0.value,
    `/subscriptions/${subscriptionId}`,
  );
  const staticUi = resources.find(({ name }) => name === "portal-static-ui");
  assert.equal(staticUi.inputs.sku.name, "Standard");
  assert(staticUi.inputs.name.includes(test ? "-test-" : "-prod-"));
  const frontDoor = resources.find(({ name }) => name === "portal-front-door");
  assert.equal(frontDoor.inputs.sku.name, "Standard_AzureFrontDoor");
  assert.equal(frontDoor.inputs.originResponseTimeoutSeconds, 240);
  assert(frontDoor.inputs.profileName.includes(test ? "-test-" : "-prod-"));
  const testDomain = resources.find(
    ({ name }) => name === "portal-test-custom-domain",
  );
  if (test) {
    assert.equal(testDomain.inputs.hostName, "test.probono-law.com");
    assert.equal(testDomain.inputs.tlsSettings.minimumTlsVersion, "TLS12");
    assert.equal(testDomain.inputs.tlsSettings.cipherSuiteSetType, "TLS12_2023");
    assert.equal(
      testDomain.inputs.tlsSettings.certificateType,
      "ManagedCertificate",
    );
  } else {
    assert.equal(testDomain, undefined);
  }
  const productionDomain = resources.find(
    ({ name }) => name === "portal-production-custom-domain",
  );
  const productionWwwDomain = resources.find(
    ({ name }) => name === "portal-production-www-custom-domain",
  );
  if (test) {
    assert.equal(productionDomain, undefined);
    assert.equal(productionWwwDomain, undefined);
  } else {
    assert.equal(productionDomain.inputs.hostName, "probono-law.com");
    assert.equal(
      productionDomain.inputs.tlsSettings.cipherSuiteSetType,
      "TLS12_2023",
    );
    assert.equal(
      productionDomain.inputs.tlsSettings.certificateType,
      "ManagedCertificate",
    );
    assert(
      productionDomain.inputs.customDomainName.includes("-1234567890abcdef"),
    );
    assert.equal(productionWwwDomain.inputs.hostName, "www.probono-law.com");
    assert.equal(
      productionWwwDomain.inputs.tlsSettings.cipherSuiteSetType,
      "TLS12_2023",
    );
    assert.equal(
      productionWwwDomain.inputs.tlsSettings.certificateType,
      "ManagedCertificate",
    );
    const zone = resources.find(
      ({ name }) => name === "portal-production-public-dns-zone",
    );
    assert.equal(zone.inputs.zoneName, "probono-law.com");
    assert.equal(zone.inputs.zoneType, "Public");
    const apex = resources.find(
      ({ name }) => name === "portal-production-apex",
    );
    if (productionApexFrontDoor) {
      assert.equal(apex.inputs.aRecords, undefined);
      assert.equal(
        apex.inputs.targetResource.id,
        "/mock/portal-front-door-endpoint",
      );
    } else {
      assert.deepEqual(apex.inputs.aRecords, [{ ipv4Address: "203.0.113.153" }]);
      assert.equal(
        apex.inputs.targetResource,
        undefined,
        "Apex remains on legacy portal before cutover",
      );
    }
    const mail = resources.find(
      ({ name }) => name === "portal-production-mail-mx",
    );
    assert.deepEqual(mail.inputs.mxRecords, [
      {
        preference: 0,
        exchange: "probonolaw-com01i.mail.protection.outlook.com",
      },
    ]);
    const testCname = resources.find(
      ({ name }) => name === "portal-production-test-cname",
    );
    assert.equal(
      testCname.inputs.cnameRecord.cname,
      "probonolaw-test-testsuffix001-c8e0avf5dyccc6a3.z01.azurefd.net",
    );
    const wwwCname = resources.find(
      ({ name }) => name === "portal-production-www-cname",
    );
    assert.equal(
      wwwCname.inputs.cnameRecord.cname,
      "portal-front-door-endpoint.azurefd.net",
    );
    const wwwValidation = resources.find(
      ({ name }) => name === "portal-production-www-front-door-validation",
    );
    assert.equal(wwwValidation.inputs.relativeRecordSetName, "_dnsauth.www");
    const wildcard = resources.find(
      ({ name }) => name === "portal-production-wildcard-cname",
    );
    assert.equal(!!wildcard, keepLegacyPortalWebApp);
    if (wildcard)
      assert.equal(
        wildcard.inputs.cnameRecord.cname,
        "portal-front-door-endpoint.azurefd.net",
      );
    const prodApi = resources.find(
      ({ name }) => name === "portal-production-prod-api-origin",
    );
    assert.equal(
      prodApi.inputs.relativeRecordSetName,
      "api-origin-1234567890abcdef",
    );
    assert.deepEqual(prodApi.inputs.aRecords, [
      { ipv4Address: "203.0.113.10" },
    ]);
  }
  const apiIp = resources.find(({ name }) => name === "portal-api-public-ip");
  assert.equal(apiIp.inputs.publicIPAllocationMethod, "Static");
  assert.equal(apiIp.inputs.sku.name, "Standard");
  assert(apiIp.inputs.publicIpAddressName.includes(test ? "-test-" : "-prod-"));
  const apiIpGrant = resources.find(
    ({ name }) => name === "portal-api-public-ip-network-contributor",
  );
  assert.equal(apiIpGrant.inputs.scope, "/mock/portal-api-public-ip");
  assert.equal(
    apiIpGrant.inputs.principalId,
    test
      ? "aks-test-north-control-plane-identity-principal"
      : "aks-production-north-control-plane-identity-principal",
  );
  const productionCiGrant = resources.find(
    ({ name }) => name === "portal-api-production-ci-cluster-admin",
  );
  if (test) {
    assert.equal(productionCiGrant, undefined);
  } else {
    assert.equal(
      productionCiGrant.inputs.scope,
      "/mock/aks-production-cluster",
    );
    assert.equal(
      productionCiGrant.inputs.principalId,
      "00000000-0000-4000-8000-000000000014",
    );
    assert.equal(
      productionCiGrant.inputs.roleDefinitionId,
      `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b`,
    );
  }
  const uiOrigin = resources.find(
    ({ name }) => name === "portal-static-ui-origin",
  );
  const apiOrigin = resources.find(
    ({ name }) => name === "portal-aks-api-origin",
  );
  for (const name of ["portal-ui-origin-group", "portal-api-origin-group"]) {
    const group = resources.find((resource) => resource.name === name);
    assert.equal(group.inputs.loadBalancingSettings.sampleSize, 4);
    assert.equal(
      group.inputs.loadBalancingSettings.successfulSamplesRequired,
      3,
    );
  }
  assert.equal(
    uiOrigin.inputs.hostName,
    "portal-static-ui.azurestaticapps.net",
  );
  assert.equal(
    apiOrigin.inputs.hostName,
    "api-origin-1234567890abcdef.probono-law.com",
  );
  assert.equal(apiOrigin.inputs.enforceCertificateNameCheck, true);
  for (const [name, pattern, group] of [
    ["portal-api-route", "/api/*", "/mock/portal-api-origin-group"],
    ["portal-ui-route", "/*", "/mock/portal-ui-origin-group"],
  ]) {
    const route = resources.find((resource) => resource.name === name);
    assert.deepEqual(route.inputs.patternsToMatch, [pattern]);
    assert.equal(route.inputs.originGroup.id, group);
    assert.equal(route.inputs.forwardingProtocol, "HttpsOnly");
    assert.equal(route.inputs.httpsRedirect, "Enabled");
    assert.equal(route.inputs.cacheConfiguration, undefined);
    assert.deepEqual(
      route.inputs.customDomains,
      test
        ? [{ id: "/mock/portal-test-custom-domain" }]
        : [
            { id: "/mock/portal-production-custom-domain" },
            { id: "/mock/portal-production-www-custom-domain" },
          ],
    );
  }
  const fileOperationsReaders = resources.filter(({ name }) =>
    name.startsWith("file-operations-production-ci-"),
  );
  assert.equal(fileOperationsReaders.length, test ? 0 : 4);
  assert.equal(
    program.fileOperationsDeploymentReaderAssignmentIds.length,
    test ? 0 : 4,
  );
  if (!test) {
    const expectedReaders = [
      [
        "workload-identity",
        "probono-law-aks-production/providers/Microsoft.ManagedIdentity/userAssignedIdentities/file-operations-prod-workload",
        "00000000-0000-4000-8000-000000000015",
      ],
      [
        "cosmos",
        "shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/db-law-sls-prodsuffix001",
        "00000000-0000-4000-8000-000000000016",
      ],
      [
        "shared-data-storage",
        "shared-storage-northcentral/providers/Microsoft.Storage/storageAccounts/probonolawdataprodsuffix",
        "00000000-0000-4000-8000-000000000009",
      ],
      [
        "search",
        "shared-dbs/providers/Microsoft.Search/searchServices/aimie-search-74239",
        "00000000-0000-4000-8000-000000000017",
      ],
    ];
    for (const [name, resource, assignmentId] of expectedReaders) {
      const grant = fileOperationsReaders.find(
        (row) => row.name === `file-operations-production-ci-${name}-reader`,
      );
      assert(grant, `Production CI ${name} Reader grant`);
      assert.equal(grant.type, "azure-native:authorization:RoleAssignment");
      assert.equal(
        grant.inputs.principalId,
        "file-operations-ci-prod-principal",
      );
      assert.equal(grant.inputs.principalType, "ServicePrincipal");
      assert.equal(
        grant.inputs.scope,
        `/subscriptions/${subscriptionId}/resourceGroups/${resource}`,
      );
      assert.equal(
        grant.inputs.roleDefinitionId,
        `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7`,
      );
      assert.equal(
        grant.inputs.roleAssignmentName,
        assignmentId,
        "Adopt the existing Azure grant ID",
      );
    }
  }
  const metadataReader = resources.find(
    ({ name }) => name === "cosmos-account-metadata-reader",
  );
  assert(metadataReader, "Cosmos metadata reader role");
  assert.equal(
    metadataReader.inputs.roleName,
    "Cosmos Metadata and Query Executor",
  );
  assert.equal(
    metadataReader.inputs.roleDefinitionId,
    "00000000-0000-4000-8000-000000000018",
  );
  assert.deepEqual(metadataReader.inputs.permissions[0].dataActions, [
    "Microsoft.DocumentDB/databaseAccounts/readMetadata",
    "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/executeQuery",
    ...(test
      ? [
          "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/read",
        ]
      : []),
  ]);
  assert.deepEqual(metadataReader.inputs.assignableScopes, [
    "/mock/db-law-serverless-pilot",
  ]);
  const metadataAssignment = resources.find(
    ({ name }) => name === "cosmos-operator-metadata-access",
  );
  assert(metadataAssignment, "Cosmos metadata assignment");
  assert.equal(
    metadataAssignment.inputs.principalId,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    metadataAssignment.inputs.roleDefinitionId,
    "/mock/cosmos-account-metadata-reader",
  );
  assert.equal(
    metadataAssignment.inputs.scope,
    "/mock/db-law-serverless-pilot",
  );
  const roleManager = resources.find(
    ({ name }) => name === "cosmos-sql-role-manager",
  );
  assert(roleManager, "Cosmos SQL role manager");
  assert.equal(
    roleManager.inputs.roleName,
    test ? "Cosmos SQL Role Manager" : "Cosmos SQL Role Manager - Production",
  );
  assert.equal(roleManager.inputs.scope, "/mock/shared-dbs");
  assert.deepEqual(roleManager.inputs.assignableScopes, ["/mock/shared-dbs"]);
  assert.deepEqual(roleManager.inputs.permissions[0].actions, [
    "Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions/read",
    "Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/read",
    "Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/write",
  ]);
  const roleManagerAssignment = resources.find(
    ({ name }) => name === "cosmos-operator-sql-role-manager",
  );
  assert(roleManagerAssignment, "Cosmos SQL role manager assignment");
  assert.equal(
    roleManagerAssignment.inputs.principalId,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(roleManagerAssignment.inputs.principalType, "User");
  assert.equal(
    roleManagerAssignment.inputs.scope,
    "/mock/db-law-serverless-pilot",
  );
  const grafanaEditor = resources.find(
    ({ name }) =>
      name ===
      (test
        ? "grafana-test-deployment-editor"
        : "grafana-production-deployment-editor"),
  );
  assert(grafanaEditor, "Grafana deployment Editor assignment");
  assert.equal(
    grafanaEditor.inputs.principalId,
    test
      ? "00000000-0000-4000-8000-000000000019"
      : "00000000-0000-4000-8000-000000000014",
  );
  assert.equal(
    grafanaEditor.inputs.roleDefinitionId,
    `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/a79a5197-3a5c-4973-a920-486035ffd60f`,
  );
  if (test) {
    assert.equal(
      grafanaEditor.id,
      "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/defaultresourcegroup-scus/providers/Microsoft.Dashboard/grafana/grafana-202691141356-sc/providers/Microsoft.Authorization/roleAssignments/00000000-0000-4000-8000-00000000001a",
    );
    assert.equal(
      grafanaEditor.inputs.roleAssignmentName,
      "00000000-0000-4000-8000-00000000001a",
    );
    assert.equal(
      grafanaEditor.inputs.scope,
      "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/defaultresourcegroup-scus/providers/Microsoft.Dashboard/grafana/grafana-202691141356-sc",
    );
  } else {
    const grafana = resources.find(({ name }) => name === "grafana-production");
    assert.equal(grafana.inputs.workspaceName, "probonolaw-grafana-prod");
    assert.equal(grafana.inputs.identity.type, "SystemAssigned");
    assert.equal(grafanaEditor.inputs.scope, "/mock/grafana-production");
    const fileOperationsEditor = resources.find(
      ({ name }) => name === "grafana-production-file-operations-editor",
    );
    assert(fileOperationsEditor, "File Operations dashboard Editor assignment");
    assert.equal(
      fileOperationsEditor.inputs.principalId,
      "file-operations-ci-prod-principal",
    );
    assert.equal(fileOperationsEditor.inputs.scope, grafanaEditor.inputs.scope);
    assert.equal(
      fileOperationsEditor.inputs.roleDefinitionId,
      grafanaEditor.inputs.roleDefinitionId,
    );
    const fileOperationsReader = resources.find(
      ({ name }) => name === "grafana-production-file-operations-reader",
    );
    assert(
      fileOperationsReader,
      "File Operations Grafana metadata Reader assignment",
    );
    assert.equal(
      fileOperationsReader.inputs.principalId,
      fileOperationsEditor.inputs.principalId,
    );
    assert.equal(fileOperationsReader.inputs.scope, grafanaEditor.inputs.scope);
    assert.equal(
      fileOperationsReader.inputs.roleDefinitionId,
      `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7`,
    );
    const logReader = resources.find(
      ({ name }) => name === "grafana-production-logs-reader",
    );
    assert.equal(logReader.inputs.principalId, "grafana-production-principal");
    assert.equal(
      logReader.inputs.scope,
      `/subscriptions/${subscriptionId}/resourceGroups/aimie-data-automation/providers/Microsoft.OperationalInsights/workspaces/aimie-data-automationwsvdqzxqu4`,
    );
  }
  const subnetNames = new Set(
    resources
      .filter(({ type }) => type === "azure-native:network:Subnet")
      .map(({ inputs }) => inputs.subnetName),
  );
  for (const name of [
    "aimie",
    "data-law-requirements-fulfillment",
    "aimie-notification-server-farm",
    "aimie-data-automation-logic-apps-server-farm",
    "markdown-html-converter",
    "markdown-converter-flex-consolidated",
  ]) {
    assert(!subnetNames.has(name), "Retired subnet remains: " + name);
  }
  assert.deepEqual([...subnetNames].sort(), ["aks", "private-endpoints"]);
  const northVnet = resources.find(({ name }) => name === "aks-north-vnet");
  assert.equal(northVnet?.inputs.location, "northcentralus");
  assert.deepEqual(northVnet.inputs.addressSpace.addressPrefixes, [
    "172.28.243.0/24",
  ]);
  for (const resource of resources) {
    if (resource.type === "azure-native:network:PrivateEndpoint") {
      assert.equal(resource.inputs.location, "northcentralus", resource.name);
      assert.equal(
        resource.inputs.subnet.id,
        "/mock/shared-storage-northcentral-subnet",
        resource.name,
      );
    }
    assert(
      !/\/virtualNetworks\/(flex-functions|vnet-logic-apps-operations)(\/|"|$)/i.test(
        JSON.stringify(resource.inputs),
      ),
      `${resource.name} references a retired VNet`,
    );
    if (resource.type === "azure-native:privatedns:VirtualNetworkLink") {
      assert.equal(
        resource.inputs.virtualNetwork.id,
        "/mock/aks-north-vnet",
        resource.name,
      );
    }
  }
  assert(
    resources.some(({ name }) => name === "search-northcentral-pe"),
    "Search endpoint is managed",
  );
  const northPrivateZoneLinks = resources.filter(
    ({ type, name }) =>
      type === "azure-native:privatedns:VirtualNetworkLink" &&
      name.startsWith("aks-north-"),
  );
  assert.equal(northPrivateZoneLinks.length, 14);
  const aksVaultLock = resources.find(
    ({ type, name }) =>
      type === "azure-native:authorization:ManagementLockByScope" &&
      name ===
        (test
          ? "aks-test-secrets-vault-lock"
          : "aks-production-secrets-vault-deletion-lock"),
  );
  assert(aksVaultLock, "AKS secrets vault deletion lock");
  assert.equal(aksVaultLock.inputs.level, "CanNotDelete");
  assert.equal(
    aksVaultLock.inputs.lockName,
    test ? "protect-probonolawakssecrets" : "protect-probonolawakssecretsprod",
  );
  if (test) {
    const caLock = resources.find(
      ({ name }) => name === "aks-test-internal-ca-vault-deletion-lock",
    );
    assert.equal(caLock?.inputs.lockName, "protect-probonolawtestca");
    assert.equal(caLock.inputs.level, "CanNotDelete");
    assert(program.aksClusterId, "Test replacement AKS cluster output");
    assert(program.aksRegistryId, "Existing Test registry output");
    assert(program.aksSecretsVaultId, "Protected Test secrets vault output");
    const subnet = resources.find(({ name }) => name === "aks-north-subnet");
    assert.equal(subnet?.inputs.addressPrefix, "172.28.243.0/25");
    assert.equal(subnet.inputs.virtualNetworkName, "aks-northcentral");
    const vault = resources.find(
      ({ name }) => name === "aks-test-secrets-vault",
    );
    assert.equal(vault?.inputs.vaultName, "probonolawakssecrets");
    assert.equal(vault.inputs.properties.enablePurgeProtection, true);
    assert.equal(vault.inputs.properties.networkAcls.defaultAction, "Deny");
    assert.equal(
      vault.inputs.properties.networkAcls.virtualNetworkRules.length,
      1,
    );
    const cluster = resources.find(
      ({ name }) => name === "aks-test-north-cluster",
    );
    assert.equal(cluster?.inputs.location, "northcentralus");
    assert.equal(cluster.inputs.resourceName, "probono-law-aks-test-nc");
    assert(
      `MC_probono-law-aks-test-northcentral_${cluster.inputs.resourceName}_${cluster.inputs.location}`
        .length <= 80,
    );
    assert.equal(
      cluster.inputs.agentPoolProfiles[0].vmSize,
      "Standard_D2as_v7",
    );
    assert.equal(cluster.inputs.agentPoolProfiles[0].minCount, 4);
    assert.equal(cluster.inputs.agentPoolProfiles[0].maxCount, 6);
    assert.equal(
      cluster.inputs.agentPoolProfiles[0].vnetSubnetID,
      "/mock/aks-north-subnet",
    );
    assert.equal(cluster.inputs.sku.tier, "Free");
    assert(
      resources.some(({ name }) => name === "aks-test-north-internal-dns-link"),
    );
    assert.equal(cluster.inputs.oidcIssuerProfile.enabled, true);
    assert.equal(cluster.inputs.securityProfile.workloadIdentity.enabled, true);
    assert.equal(
      cluster.inputs.ingressProfile.webAppRouting.nginx
        .defaultIngressControllerType,
      "Internal",
    );
    for (const name of [
      "aks-test-north-subnet-network-contributor",
      "aks-test-north-vnet-reader",
      "aks-test-north-registry-pull",
      "aks-test-north-routing-dns-contributor",
      "aks-test-north-routing-certificate-reader",
      "aks-test-north-operator-cluster-admin",
      "aks-test-north-deployment-manager-cluster-admin",
    ]) {
      assert(
        resources.some(({ name: resourceName }) => resourceName === name),
        `${name} grant`,
      );
    }
    const federations = resources.filter(
      ({ type }) =>
        type === "azure-native:managedidentity:FederatedIdentityCredential",
    );
    assert.equal(federations.length, 10);
    for (const { inputs } of federations) {
      assert.equal(
        inputs.federatedIdentityCredentialResourceName,
        "aks-test-northcentral",
      );
      assert.equal(inputs.audiences[0], "api://AzureADTokenExchange");
      assert(inputs.subject.startsWith("system:serviceaccount:"));
    }
  } else {
    assert(program.aksClusterId, "Production AKS cluster output");
    assert(program.aksRegistryId, "Production registry output");
    assert(program.aksSecretsVaultId, "Production secrets vault output");
    const registry = resources.find(
      ({ name }) => name === "aks-production-registry",
    );
    assert.equal(registry?.inputs.registryName, "probonolawservicesprod");
    assert.equal(registry.inputs.adminUserEnabled, false);
    const vault = resources.find(
      ({ name }) => name === "aks-production-secrets-vault",
    );
    assert.equal(vault?.inputs.vaultName, "probonolawakssecretsprod");
    assert.equal(vault.inputs.properties.enablePurgeProtection, true);
    assert.equal(vault.inputs.properties.softDeleteRetentionInDays, 90);
    assert.equal(vault.inputs.properties.networkAcls.defaultAction, "Deny");
    const subnet = resources.find(({ name }) => name === "aks-north-subnet");
    assert.equal(subnet?.inputs.addressPrefix, "172.28.243.0/25");
    assert.equal(subnet.inputs.subnetName, "aks");
    assert.equal(subnet.inputs.virtualNetworkName, "aks-northcentral");
    const cluster = resources.find(
      ({ name }) => name === "aks-production-cluster",
    );
    assert.equal(cluster?.inputs.resourceName, "probono-law-aks-prod");
    assert.equal(cluster.inputs.location, "northcentralus");
    assert.equal(
      cluster.inputs.agentPoolProfiles[0].vmSize,
      "Standard_D2as_v7",
    );
    assert.equal(
      cluster.inputs.agentPoolProfiles[0].vnetSubnetID,
      "/mock/aks-north-subnet",
    );
    assert.equal(cluster.inputs.oidcIssuerProfile.enabled, true);
    assert.equal(cluster.inputs.securityProfile.workloadIdentity.enabled, true);
    assert.equal(
      cluster.inputs.addonProfiles.azureKeyvaultSecretsProvider.enabled,
      true,
    );
    assert.equal(cluster.inputs.azureMonitorProfile.metrics.enabled, true);
    const prometheusWorkspace = resources.find(
      ({ name }) => name === "aks-production-prometheus-workspace",
    );
    assert.equal(
      prometheusWorkspace?.inputs.azureMonitorWorkspaceName,
      "probono-law-aks-prod-amw",
    );
    assert.equal(prometheusWorkspace.inputs.location, "centralus");
    assert.equal(
      cluster.inputs.ingressProfile.webAppRouting.nginx
        .defaultIngressControllerType,
      "Internal",
    );
    const zone = resources.find(
      ({ name }) => name === "aks-production-internal-zone",
    );
    assert.equal(zone?.inputs.privateZoneName, "internal.probono-law.com");
    const caVault = resources.find(
      ({ name }) => name === "aks-production-internal-ca-vault",
    );
    assert.equal(caVault?.inputs.vaultName, "probonolawprodca");
    assert.equal(caVault.inputs.properties.enablePurgeProtection, true);
    assert.equal(caVault.inputs.properties.networkAcls.defaultAction, "Deny");
    const caLock = resources.find(
      ({ name }) => name === "aks-production-internal-ca-vault-deletion-lock",
    );
    assert.equal(caLock?.inputs.lockName, "protect-probonolawprodca");
    for (const name of ["aks-north-prod"]) {
      assert(
        resources.some(
          ({ name: resourceName }) =>
            resourceName === `aks-production-${name}-dns-link`,
        ),
      );
    }
    for (const name of [
      "aks-production-subnet-network-contributor",
      "aks-production-vnet-reader",
      "aks-production-registry-pull",
      "aks-production-routing-dns-contributor",
      "aks-production-routing-certificate-reader",
      "aks-production-operator-cluster-admin",
      "aks-production-secrets-operator",
      "aks-production-certificate-operator",
      "aks-production-ca-certificate-operator",
    ]) {
      assert(
        resources.some(({ name: resourceName }) => resourceName === name),
        `${name} grant`,
      );
    }
  }
  const consolidatedNamespace = resources.find(
    ({ type, name }) =>
      type === "azure-native:eventhub:Namespace" &&
      name === "consolidated-eventhub",
  );
  assert(consolidatedNamespace, "Consolidated Event Hubs namespace");
  assert.deepEqual(
    resources
      .filter(({ type }) => type === "azure-native:eventhub:Namespace")
      .map(({ name }) => name),
    ["consolidated-eventhub"],
    "Only the consolidated Event Hubs namespace is managed",
  );
  const eventHubTypes = new Set([
    "azure-native:eventhub:EventHub",
    "azure-native_eventhub_v20240501preview:eventhub:EventHub",
  ]);
  const consolidatedHubNames = resources
    .filter(
      ({ type, name }) =>
        eventHubTypes.has(type) && name.startsWith("consolidated-"),
    )
    .map(({ inputs }) => inputs.eventHubName)
    .sort();
  assert.deepEqual(consolidatedHubNames, [
    "account-operations",
    "aimie-request-queue",
    "aimie-response-queue",
    "chatbot-trigger",
    "declaration-processing-requests",
    "email-operations",
    "file-operations",
    "state-events",
  ]);
  const accountOperations = resources.find(
    ({ type, name }) =>
      type === "azure-native:eventhub:EventHub" &&
      name === "consolidated-account-operations",
  );
  assert(accountOperations, "Consolidated account operations hub");
  assert.equal(accountOperations.inputs.partitionCount, 17);
  assert.equal(accountOperations.inputs.messageRetentionInDays, 7);
  assert(
    !resources.some(
      ({ type, name }) =>
        type === "azure-native:eventhub:ConsumerGroup" &&
        name.startsWith("consolidated-") &&
        name.endsWith("-default"),
    ),
    "Azure creates $Default for consolidated Event Hubs",
  );
  const stateEvents = resources.find(
    ({ type, name }) =>
      type === "azure-native_eventhub_v20240501preview:eventhub:EventHub" &&
      name === "consolidated-state-events",
  );
  assert(
    stateEvents,
    "Compacted state-events hub uses the correct API version",
  );
  assert.equal(
    stateEvents.inputs.retentionDescription.cleanupPolicy,
    "Compact",
  );
  assert.equal(
    stateEvents.inputs.retentionDescription.tombstoneRetentionTimeInHours,
    96,
  );
  assert(
    !resources.some(({ name }) => name === "consolidated-eventhub-root-rule"),
    "Azure creates the root authorization rule with the namespace",
  );
  // Data Integrity still requires Document Intelligence alongside VI and CU.
  const documentIntelligence = resources.find(
    ({ type, name }) =>
      type === "azure-native:cognitiveservices:Account" &&
      name === "cognitive-service",
  );
  assert(
    documentIntelligence,
    "Data Integrity Document Intelligence account remains",
  );
  assert.equal(documentIntelligence.inputs.kind, "CognitiveServices");
  assert.equal(
    documentIntelligence.inputs.resourceGroupName,
    "data-loader-foundry",
  );
  const documentIntelligenceEndpoint = resources.find(
    ({ type, name }) =>
      type === "azure-native:network:PrivateEndpoint" &&
      name === "cognitive-logic-pe",
  );
  assert(
    documentIntelligenceEndpoint,
    "Document Intelligence private endpoint remains",
  );
  assert.equal(
    documentIntelligenceEndpoint.inputs.privateLinkServiceConnections[0]
      .privateLinkServiceId,
    "/mock/cognitive-service",
  );
  const contentUnderstanding = resources.find(
    ({ type, name }) =>
      type === "azure-native:cognitiveservices:Account" &&
      name === "aimie3-foundry",
  );
  assert(contentUnderstanding, "Content Understanding Foundry account remains");
  assert.equal(contentUnderstanding.inputs.kind, "AIServices");
  const primaryFoundryDnsGroup = resources.find(
    ({ type, name }) =>
      type === "azure-native:network:PrivateDnsZoneGroup" &&
      name === "aimie3-logic-pe-dns",
  );
  assert(primaryFoundryDnsGroup, "Primary Foundry private DNS zone group");
  assert.deepEqual(
    primaryFoundryDnsGroup.inputs.privateDnsZoneConfigs
      .map(({ name }) => name)
      .sort(),
    [
      "privatelink.cognitiveservices.azure.com",
      "privatelink.openai.azure.com",
      "privatelink.services.ai.azure.com",
    ].sort(),
  );
  for (const key of [
    "dataAutomation",
    "integrityCache",
    "aimie",
    "aimieConfig",
    "probonoPortal",
    "dataIntegrityExtractor",
    "dataIngestion",
    "portalStarter",
    "resourceManager",
  ]) {
    assert(!(key in program.storageAccountIds), key + " storage is retired");
  }
  assert.deepEqual(Object.keys(program.storageAccountIds).sort(), [
    "sharedAimie",
    "sharedData",
  ]);
  const viEndpoint = resources.find(
    ({ name }) => name === "video-indexer-v2-pe",
  );
  assert.equal(viEndpoint.inputs.location, "northcentralus");
  assert.equal(
    viEndpoint.inputs.subnet.id,
    "/mock/shared-storage-northcentral-subnet",
  );
  assert.deepEqual(
    viEndpoint.inputs.privateLinkServiceConnections[0].groupIds,
    ["account"],
  );
  const viAccount = resources.find(
    ({ name }) => name === "video-indexer-v2-account",
  );
  assert.equal(viAccount.inputs.publicNetworkAccess, "Disabled");
  assert.equal(
    viAccount.inputs.accountId,
    test
      ? "00000000-0000-4000-8000-00000000000a"
      : "00000000-0000-4000-8000-00000000000b",
  );
  const runtimeViGrant = resources.find(
    ({ name }) => name === "integrity-extractor-aks-video-indexer-v2-token",
  );
  assert.equal(
    runtimeViGrant.inputs.principalId,
    "file-operations-" + (test ? "test" : "prod") + "-workload-principal",
  );
  assert.equal(runtimeViGrant.inputs.scope, "/mock/video-indexer-v2-account");
  const serverlessAccount = resources.find(
    ({ name }) => name === "db-law-serverless-pilot",
  );
  assert(
    serverlessAccount,
    "Existing Cosmos DB account retains its logical name",
  );
  assert.equal(
    serverlessAccount.inputs.location,
    "centralus",
    "ARM home location is immutable",
  );
  assert.deepEqual(
    serverlessAccount.inputs.capabilities,
    cosmosProvisioned ? [] : [{ name: "EnableServerless" }],
  );
  assert.deepEqual(serverlessAccount.inputs.locations, [
    {
      locationName: cosmosNorthCentral ? "North Central US" : "Central US",
      failoverPriority: 0,
      isZoneRedundant: cosmosNorthCentral,
    },
  ]);
  const cosmosAutoscale = resources.filter(
    ({ name }) => name.startsWith("cosmos-") && name.endsWith("-autoscale"),
  );
  assert.equal(cosmosAutoscale.length, cosmosNorthCentral ? 9 : 0);
  for (const deployment of cosmosAutoscale) {
    const resource = deployment.inputs.properties.template.resources[0];
    const container = deployment.name.slice(
      "cosmos-".length,
      -"-autoscale".length,
    );
    assert.equal(
      resource.type,
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/throughputSettings",
    );
    assert.equal(
      resource.properties.resource.autoscaleSettings.maxThroughput,
      container === "messages2" ? 5000 : container === "notices" ? 2000 : 1000,
    );
    assert(resource.name.endsWith(`/${container}/default`));
  }
  assert.deepEqual(
    serverlessAccount.inputs.ipRules.map(
      ({ ipAddressOrRange }) => ipAddressOrRange,
    ),
    [
      environmentName === "Test" ? "203.0.113.150" : "203.0.113.151",
      ...(environmentName === "Production" ? ["203.0.113.152"] : []),
      "4.210.172.107",
      "13.88.56.148",
      "13.91.105.215",
      "40.91.218.243",
    ],
  );
  const serverlessContainers = resources
    .filter(
      ({ name }) =>
        name.startsWith("cosmos-") && name.endsWith("-serverless-pilot"),
    )
    .map(({ inputs }) => inputs.containerName)
    .sort();
  assert.deepEqual(serverlessContainers, [
    "accountUsage",
    "accounts",
    "aimieStats",
    ...(!test ? ["billingRuns"] : []),
    "clientFeedbackRequests",
    "feedback",
    "messages2",
    "notices",
    "requests",
  ]);
  if (!test) {
    const billingRuns = resources.find(
      ({ name }) => name === "cosmos-billingRuns-serverless-pilot",
    );
    assert.deepEqual(billingRuns?.inputs.resource.partitionKey.paths, [
      "/accountId",
    ]);
  }
  assert(
    resources.every(
      ({ name }) =>
        !name.includes("accountsBilling") && !name.includes("accounts-billing"),
    ),
    "Accounts Billing resources are retired",
  );
  assert(!("accounts-billing" in program.resourceGroupIds));
  assert(!("accountsBilling" in program.storageAccountIds));
  assert(!("accountsBilling" in program.appIds));
  assert(!("accountsBilling" in program.workspaceIds));
  assert(!("dataIngestion" in program.appIds));
  assert(!("dataIngestionFlex" in program.appIds));
  if (environmentName === "Test") {
    assert("aimie-service" in program.resourceGroupIds);
    assert(!("aimie" in program.storageAccountIds));
    assert("aimie" in program.workspaceIds);
    assert(!("aimie" in program.appIds));
    assert(!resources.some(({ name }) => name === "aimie-plan"));
    assert(
      !resources.some(({ name }) => name === "aimie-service-logic-site-pe"),
    );
    assert(!resources.some(({ name }) => name === "aimie-config-blob-reader"));
    const aimieStorageEndpoints = resources
      .filter(
        ({ type, name }) =>
          type === "azure-native:network:PrivateEndpoint" &&
          name.startsWith("aimieConsolidated-storage-"),
      )
      .map(({ name }) => name)
      .sort();
    assert.deepEqual(aimieStorageEndpoints, []);
    assert(!("markdown-html-converter" in program.resourceGroupIds));
    assert(!("markdownConverter" in program.storageAccountIds));
    assert(!("markdownConverter" in program.workspaceIds));
    assert(!("markdownConverter" in program.appIds));
    for (const name of [
      "aks-test-ingress-subnet-network-contributor",
      "aks-test-ingress-vnet-reader",
      "aks-test-routing-private-dns-contributor",
      "aks-test-routing-key-vault-secrets-user",
    ]) {
      assert(!resources.some((resource) => resource.name === name));
    }
    const markdownZone = resources.find(
      ({ name }) => name === "aks-test-internal-probono-law-zone",
    );
    assert(markdownZone, "Test converter private DNS zone");
    assert.equal(
      markdownZone.inputs.privateZoneName,
      "internal.probono-law.com",
    );
    const caVault = resources.find(
      ({ name }) => name === "aks-test-internal-ca-vault",
    );
    assert(caVault, "Test internal CA vault");
    assert.equal(caVault.inputs.vaultName, "probonolawtestca");
    assert.equal(caVault.inputs.properties.networkAcls.defaultAction, "Deny");
    const caOfficer = resources.find(
      ({ name }) => name === "aks-test-internal-ca-certificate-officer",
    );
    assert(caOfficer, "Test internal CA certificate officer");
    assert.equal(
      caOfficer.inputs.principalId,
      "00000000-0000-4000-8000-000000000001",
    );

    for (const [group, key, appKey, retiredPrefixes] of [
      [
        "data-ingestion-svc",
        "dataIngestion",
        "dataIngestionFlex",
        [
          "data-ingestion-storage",
          "data-ingestion-flex-",
          "dataIngestion-storage-",
        ],
      ],
      [
        "aimie-notification",
        "aimieNotification",
        "aimieNotification",
        [
          "aimie-notification-storage",
          "aimie-notification-flex-",
          "aimieNotification-storage-",
        ],
      ],
    ]) {
      assert(group in program.resourceGroupIds);
      assert(key in program.workspaceIds);
      assert(!(key in program.storageAccountIds));
      assert(!(appKey in program.appIds));
      assert(
        !resources.some(({ name }) =>
          retiredPrefixes.some((prefix) => name.startsWith(prefix)),
        ),
        `${key} Function and storage are retired in Test`,
      );
    }
    assert(!("integrityCache" in program.storageAccountIds));
    assert("data-integrity-extractor" in program.resourceGroupIds);
    assert("dataIntegrityExtractor" in program.workspaceIds);
    assert(!("dataIntegrityExtractor" in program.storageAccountIds));
    assert(!("dataIntegrityExtractor" in program.appIds));
    for (const prefix of [
      "data-integrity-extractor-storage",
      "data-integrity-extractor-flex-",
      "dataIntegrityExtractor-storage-",
      "integrity-extractor-flex-",
    ]) {
      assert(
        !resources.some(({ name }) => name.startsWith(prefix)),
        `${prefix} is retired in Test`,
      );
    }
    const videoIndexerRole = resources.find(
      ({ name }) => name === "video-indexer-token-generator-role",
    );
    assert(videoIndexerRole, "Video Indexer token role remains in Test");
    assert.deepEqual(videoIndexerRole.inputs.permissions[0].actions, [
      "Microsoft.VideoIndexer/accounts/read",
      "Microsoft.VideoIndexer/accounts/generateAccessToken/action",
    ]);
    assert.equal(
      videoIndexerRole.inputs.roleDefinitionId,
      "00000000-0000-4000-8000-00000000000e",
    );
    const videoIndexerGrant = resources.find(
      ({ name }) => name === "integrity-extractor-aks-video-indexer-v2-token",
    );
    assert(
      videoIndexerGrant,
      "AKS integrity workload can request Video Indexer tokens",
    );
    assert.equal(
      videoIndexerGrant.inputs.principalId,
      "file-operations-test-workload-principal",
    );
    assert.equal(
      videoIndexerGrant.inputs.roleAssignmentName,
      "00000000-0000-4000-8000-00000000001b",
    );
    assert(
      resources.some(
        ({ name }) => name === "document-integrity-cognitive-services-pe",
      ),
      "Document Ingress private endpoint remains in Test",
    );
    assert(
      resources.some(({ name }) => name === "aimie-notification-webpubsub-pe"),
      "Notification Web PubSub private endpoint remains in Test",
    );
    for (const [group, key] of [
      ["portal-starter", "portalStarter"],
      ["resource-manager", "resourceManager"],
    ]) {
      assert(!(group in program.resourceGroupIds));
      assert(!(key in program.storageAccountIds));
      assert(!(key in program.appIds));
      assert(!(key in program.workspaceIds));
      assert(
        !resources.some(({ inputs }) => inputs.resourceGroupName === group),
        `${group} resources are retired in Test`,
      );
    }
    assert("aimie-data-automation" in program.resourceGroupIds);
    assert(!("dataAutomation" in program.storageAccountIds));
    assert("dataAutomation" in program.workspaceIds);
    assert(!("dataAutomation" in program.appIds));
    for (const name of [
      "dataAutomation-plan",
      "data-automation-app",
      "data-automation-site-pe",
      "data-automation-host-binding",
      "data-automation-vnet-connection",
    ]) {
      assert(
        !resources.some((resource) => resource.name === name),
        `${name} is retired in Test`,
      );
    }
    assert(
      !resources.some(
        ({ type, name }) =>
          type === "azure-native:authorization:RoleAssignment" &&
          name.startsWith("data-automation-"),
      ),
      "Data Automation app role assignments are retired in Test",
    );
  }
  assert(
    !resources.some(
      ({ name }) =>
        name === "data-ingestion-app" ||
        name === "data-ingestion-site-pe" ||
        name.startsWith("data-ingestion-serverless-pilot-") ||
        name === "data-ingestion-integrity-blob-contributor" ||
        name === "data-ingestion-event-sender",
    ),
    "Dedicated Data Ingestion resources are retired",
  );
  const linuxPlans = resources.filter(
    ({ type, inputs }) =>
      type === "azure-native:web:AppServicePlan" && inputs.kind === "linux",
  );
  assert.equal(linuxPlans.length, keepLegacyPortalWebApp ? 1 : 0);
  for (const { name, inputs } of linuxPlans) {
    assert.equal(name, "probonoPortal-plan");
    assert.equal(inputs.sku.name, skuName, name);
    assert.equal(
      inputs.sku.tier,
      skuName === "P0v3" ? "Premium0V3" : "Basic",
      name,
    );
    assert.equal(inputs.sku.capacity, 1, name);
  }
  assert.equal(
    counts.get("azure-native:network:VirtualNetworkPeering") ?? 0,
    0,
  );
  const sites = resources.filter(
    ({ type }) => type === "azure-native:web:WebApp",
  );
  assert.deepEqual(
    sites.map(({ name }) => name),
    keepLegacyPortalWebApp ? ["probonolaw-portal-app"] : [],
    "Only Production keeps the legacy portal until apex cutover",
  );
  assert.equal("probonoPortal" in program.appIds, keepLegacyPortalWebApp);
  for (const key of [
    "dataAutomation",
    "resourceManager",
    "markdownConverter",
    "portalStarter",
    "aimieNotification",
    "dataIntegrityExtractor",
    "dataIngestionFlex",
    "aimie",
  ]) {
    assert(!(key in program.appIds), key + " Function or Logic App is retired");
  }
  if (environmentName === "Production") {
    assert(!("markdownConverter" in program.storageAccountIds));
    assert.deepEqual(
      resources
        .filter(
          ({ inputs }) =>
            inputs.resourceGroupName === "markdown-html-converter",
        )
        .map(({ type }) => type)
        .sort(),
      [
        "azure-native:resources:ResourceGroup",
        "azure-native:operationalinsights:Workspace",
        "azure-native:applicationinsights:Component",
      ].sort(),
      "Markdown retains its resource group and telemetry after storage retirement",
    );
    for (const key of [
      "dataAutomation",
      "resourceManager",
      "portalStarter",
      "dataIntegrityExtractor",
      "dataIngestion",
      "aimie",
    ]) {
      assert(!(key in program.storageAccountIds), key + " storage is retired");
    }
    assert.equal("probonoPortal" in program.appIds, keepLegacyPortalWebApp);
    assert(
      resources.some(
        ({ name }) => name === "video-indexer-token-generator-role",
      ),
      "AKS Video Indexer custom role remains",
    );
  }
  const armChildTypes = new Map();
  for (const deployment of resources.filter(
    (resource) => resource.type === "azure-native:resources:Deployment",
  )) {
    for (const child of deployment.inputs.properties.template.resources) {
      armChildTypes.set(child.type, (armChildTypes.get(child.type) ?? 0) + 1);
    }
  }
  assert.deepEqual(
    Object.fromEntries(
      [...armChildTypes].sort(([a], [b]) => a.localeCompare(b)),
    ),
    {
      "Microsoft.CognitiveServices/accounts/defenderForAISettings": 2,
      ...(cosmosNorthCentral
        ? {
            "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/throughputSettings": 9,
          }
        : {}),
      "Microsoft.SignalRService/WebPubSub": 1,
    },
  );
  const deployments = new Map(
    resources
      .filter(
        (resource) =>
          resource.type === "azure-native:cognitiveservices:Deployment" ||
          resource.type ===
            "azure-native_cognitiveservices_v20260501:cognitiveservices:Deployment",
      )
      .map((resource) => [resource.name, resource.inputs]),
  );
  for (const name of ["aimie3-test1", "aimie3-gpt-5.5"]) {
    assert.equal(
      deployments.has(name),
      environmentName === "Production",
      `${name} Production-only deployment`,
    );
  }
  for (const name of [
    "aimie3-test-model-router",
    "aimie3-chat-gpt-5",
    "aimie3-gpt-5.4-nano",
  ]) {
    assert.equal(
      deployments.has(name),
      environmentName === "Test",
      `${name} Test-only deployment`,
    );
  }
  for (const [name, capacity, mode, modelNames, upgrade] of [
    [
      "fast-tasks-model-router",
      4624,
      "cost",
      ["gpt-5.6-luna"],
      "NoAutoUpgrade",
    ],
    [
      "utility-model-router",
      environmentName === "Production" ? 17494 : 12057,
      environmentName === "Production" ? "quality" : "balanced",
      ["gpt-5.6-sol", "gpt-5.6-terra"],
      environmentName === "Production"
        ? "OnceNewDefaultVersionAvailable"
        : "NoAutoUpgrade",
    ],
  ]) {
    const deployment = deployments.get(`aimie3-${name}`);
    assert(deployment, `${name} deployment in ${environmentName}`);
    assert.equal(deployment.deploymentName, name);
    assert.deepEqual(deployment.sku, { name: "GlobalStandard", capacity });
    assert.deepEqual(deployment.properties.model, {
      format: "OpenAI",
      name: "model-router",
      version: "2025-11-18",
    });
    assert.deepEqual(deployment.properties.routing, {
      mode,
      models: modelNames.map((modelName) => ({
        format: "OpenAI",
        name: modelName,
        version: "2026-07-09",
      })),
    });
    assert.equal(deployment.properties.raiPolicyName, "SensitiveInfoLevel");
    assert.equal(deployment.properties.versionUpgradeOption, upgrade);
    const resource = resources.find(
      ({ name: logicalName }) => logicalName === `aimie3-${name}`,
    );
    if (environmentName === "Test") {
      assert.equal(
        resource.id,
        `/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/primary-foundry/providers/Microsoft.CognitiveServices/accounts/aimie3-testsuffix001/deployments/${name}`,
      );
    }
  }
  assert.equal(
    deployments.get("aimie3-research-claude-sonnet-5-5").properties
      .versionUpgradeOption,
    "NoAutoUpgrade",
  );
  for (const [name, modelName, modelVersion] of [
    ["tasks-gpt-6.0-luna", "gpt-6-luna", "2026-09-22"],
    ["research-gpt-6.0-sol", "gpt-6-sol", "2026-09-22"],
    ["research-gpt-6.1-sol", "gpt-6.1-sol", "2026-09-29"],
  ]) {
    const deployment = deployments.get(`aimie3-${name}`);
    assert(deployment, `${name} deployment in ${environmentName}`);
    assert.equal(deployment.deploymentName, name);
    assert.deepEqual(deployment.sku, {
      name: "GlobalStandard",
      capacity: 5181,
    });
    assert.deepEqual(deployment.properties.model, {
      format: "OpenAI",
      name: modelName,
      version: modelVersion,
    });
    assert.equal(deployment.properties.raiPolicyName, "SensitiveInfoLevel");
  }
  const reconDeployment = resources.find(
    ({ name }) => name === "aimie3-recon-test-gpt-6-luna",
  );
  assert(reconDeployment, "Recon GPT-6 Luna deployment");
  assert.equal(reconDeployment.inputs.deploymentName, "recon-test-gpt-6-luna");
  assert.deepEqual(reconDeployment.inputs.sku, {
    name: "GlobalStandard",
    capacity: 2158,
  });
  assert.deepEqual(reconDeployment.inputs.properties.model, {
    format: "OpenAI",
    name: "gpt-6-luna",
    version: "2026-09-22",
  });
  assert.equal(
    reconDeployment.inputs.properties.raiPolicyName,
    "SensitiveInfoLevel",
  );
  assert.equal(
    reconDeployment.inputs.properties.versionUpgradeOption,
    "OnceNewDefaultVersionAvailable",
  );
  assert.equal(
    reconDeployment.id,
    environmentName === "Test"
      ? "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/primary-foundry/providers/Microsoft.CognitiveServices/accounts/aimie3-testsuffix001/deployments/recon-test-gpt-6-luna"
      : "/subscriptions/00000000-0000-4000-8000-000000000002/resourceGroups/primary-foundry/providers/Microsoft.CognitiveServices/accounts/aimie3-prodsuffix001/deployments/recon-test-gpt-6-luna",
  );
  for (const [name, modelName] of [
    ["tasks-claude-haiku-5-5", "claude-haiku-5-5"],
    ["research-claude-sonnet-5-5", "claude-sonnet-5-5"],
  ]) {
    const deployment = deployments.get(`aimie3-${name}`);
    assert(deployment, `${name} deployment in ${environmentName}`);
    assert.equal(deployment.deploymentName, name);
    assert.deepEqual(deployment.sku, {
      name: "GlobalStandard",
      capacity: 5181,
    });
    assert.deepEqual(deployment.properties.model, {
      format: "Anthropic",
      name: modelName,
      version: "2",
    });
    assert.equal(deployment.properties.raiPolicyName, "Microsoft.DefaultV2");
  }
  const argumentGpt55 = deployments.get("aimie3-argument-gpt-5.5");
  assert(argumentGpt55, "Argument GPT-5.5 deployment");
  if (environmentName === "Production") {
    assert.equal(
      argumentGpt55.sku.capacity,
      5560,
      "Production Argument GPT-5.5 quota cap",
    );
  }
  const names = new Set();
  for (const resource of resources) {
    assert(
      !names.has(resource.name),
      `Duplicate Pulumi logical name: ${resource.name}`,
    );
    names.add(resource.name);
  }
  console.log(
    `Verified ${resources.length} Pulumi resources across ${counts.size} types.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
