import * as pulumi from "@pulumi/pulumi";
import {
  authorization,
  containerregistry,
  containerservice,
  keyvault,
  managedidentity,
  monitor,
  operationalinsights,
  privatedns,
  resources,
} from "@pulumi/azure-native";
import { assign, roleIds } from "./core/iam";
import { createTestAksReplacement } from "./aksTestReplacement";
import { createAksNorthNetwork } from "./aksNorthNetwork";
import { importAksOverflowPool } from "./aksOverflowPool";

const tenantId = "00000000-0000-4000-8000-00000000001c";
const testVaultName = "probonolawakssecrets";
const testVaultGroup = "probono-law-aks-prototype";

function lockVault(
  name: string,
  lockName: string,
  vaultId: pulumi.Input<string>,
) {
  return new authorization.ManagementLockByScope(
    name,
    {
      scope: vaultId,
      lockName,
      level: "CanNotDelete",
      notes:
        "Preserve AKS application secrets and TLS certificates during cluster rebuilds",
    },
    { protect: true, retainOnDelete: true },
  );
}

export function createAksPlatform(
  environmentName: string,
  subscriptionId: pulumi.Input<string>,
  aksNorthNetwork: ReturnType<typeof createAksNorthNetwork>,
) {
  if (environmentName === "Test") {
    const testSubscriptionId = new pulumi.Config("azure-native").require(
      "subscriptionId",
    );
    const vaultId = pulumi.interpolate`${subscriptionId}/resourceGroups/${testVaultGroup}/providers/Microsoft.KeyVault/vaults/${testVaultName}`;
    new authorization.ManagementLockByScope(
      "aks-test-secrets-vault-lock",
      {
        scope: vaultId,
        lockName: "protect-probonolawakssecrets",
        level: "CanNotDelete",
        notes:
          "Preserve AKS application secrets and TLS certificates during Test rebuilds",
      },
      {
        import: `/subscriptions/${testSubscriptionId}/resourceGroups/${testVaultGroup}/providers/Microsoft.KeyVault/vaults/${testVaultName}/providers/Microsoft.Authorization/locks/protect-probonolawakssecrets`,
        protect: true,
        retainOnDelete: true,
      },
    );
    return createTestAksReplacement(subscriptionId, aksNorthNetwork);
  }
  if (environmentName !== "Production") {
    throw new Error(`Unsupported AKS environment: ${environmentName}`);
  }

  const config = new pulumi.Config();
  const nodeMinCount = config.getNumber("aksNodeMinCount") ?? 5;
  const nodeMaxCount = config.getNumber("aksNodeMaxCount") ?? 10;
  const operatorIpCidr = config.require("aksOperatorIpCidr");
  const certificateOperatorPrincipalId = config.require(
    "aksCertificateOperatorPrincipalId",
  );
  const kubernetesVersion = config.get("aksKubernetesVersion") ?? "1.35";
  if (nodeMinCount < 3 || nodeMaxCount < nodeMinCount) {
    throw new Error("AKS node counts require min >= 3 and max >= min");
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}\/32$/.test(operatorIpCidr)) {
    throw new Error("aksOperatorIpCidr must be an IPv4 /32 address");
  }
  if (
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(
      certificateOperatorPrincipalId,
    )
  ) {
    throw new Error("aksCertificateOperatorPrincipalId must be a GUID");
  }

  const clusterGroup = new resources.ResourceGroup("aks-production-group", {
    resourceGroupName: "probono-law-aks-production",
    location: "centralus",
    tags: { Environment: "Production" },
  });
  const registryGroup = new resources.ResourceGroup(
    "aks-production-registry-group",
    {
      resourceGroupName: "probono-law-containers-production",
      location: "centralus",
      tags: { Environment: "Production" },
    },
  );
  const secretsGroup = new resources.ResourceGroup(
    "aks-production-secrets-group",
    {
      resourceGroupName: "probono-law-aks-secrets-production",
      location: "centralus",
      tags: { Environment: "Production" },
    },
    { protect: true },
  );
  const dnsGroup = new resources.ResourceGroup("aks-production-dns-group", {
    resourceGroupName: "probono-law-aks-dns-production",
    location: "centralus",
    tags: { Environment: "Production" },
  });

  const subnet = aksNorthNetwork.subnet;
  const registry = new containerregistry.Registry("aks-production-registry", {
    registryName: "probonolawservicesprod",
    resourceGroupName: registryGroup.name,
    location: "centralus",
    sku: { name: "Basic" },
    adminUserEnabled: false,
    publicNetworkAccess: "Enabled",
    tags: { Environment: "Production" },
  });
  const vault = new keyvault.Vault(
    "aks-production-secrets-vault",
    {
      resourceGroupName: secretsGroup.name,
      vaultName: "probonolawakssecretsprod",
      location: "centralus",
      properties: {
        tenantId,
        sku: { family: "A", name: "standard" },
        enableRbacAuthorization: true,
        enablePurgeProtection: true,
        enableSoftDelete: true,
        softDeleteRetentionInDays: 90,
        enabledForDeployment: false,
        enabledForDiskEncryption: false,
        enabledForTemplateDeployment: false,
        publicNetworkAccess: "Enabled",
        networkAcls: {
          bypass: "None",
          defaultAction: "Deny",
          ipRules: [{ value: operatorIpCidr }],
          virtualNetworkRules: [{ id: subnet.id }],
        },
      },
      tags: { Environment: "Production" },
    },
    { protect: true, retainOnDelete: true },
  );
  lockVault(
    "aks-production-secrets-vault-deletion-lock",
    "protect-probonolawakssecretsprod",
    vault.id,
  );
  assign(
    "aks-production-secrets-operator",
    vault.id,
    certificateOperatorPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.secretsOfficer}`,
    "User",
  );
  assign(
    "aks-production-certificate-operator",
    vault.id,
    certificateOperatorPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.certificateOfficer}`,
    "User",
  );
  const caVault = new keyvault.Vault(
    "aks-production-internal-ca-vault",
    {
      resourceGroupName: secretsGroup.name,
      vaultName: "probonolawprodca",
      location: "centralus",
      properties: {
        tenantId,
        sku: { family: "A", name: "standard" },
        enableRbacAuthorization: true,
        enablePurgeProtection: true,
        enableSoftDelete: true,
        softDeleteRetentionInDays: 90,
        publicNetworkAccess: "Enabled",
        networkAcls: {
          bypass: "None",
          defaultAction: "Deny",
          ipRules: [{ value: operatorIpCidr }],
        },
      },
      tags: { Environment: "Production" },
    },
    { protect: true, retainOnDelete: true },
  );
  lockVault(
    "aks-production-internal-ca-vault-deletion-lock",
    "protect-probonolawprodca",
    caVault.id,
  );
  assign(
    "aks-production-ca-certificate-operator",
    caVault.id,
    certificateOperatorPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.certificateOfficer}`,
    "User",
  );

  const zone = new privatedns.PrivateZone("aks-production-internal-zone", {
    resourceGroupName: dnsGroup.name,
    privateZoneName: "internal.probono-law.com",
    location: "global",
  });
  for (const [name, virtualNetworkId] of [
    ["aks-north-prod", aksNorthNetwork.vnet.id],
  ] as const) {
    new privatedns.VirtualNetworkLink(
      `aks-production-${name}-dns-link`,
      {
        resourceGroupName: dnsGroup.name,
        privateZoneName: zone.name,
        virtualNetworkLinkName: name,
        location: "global",
        registrationEnabled: false,
        virtualNetwork: { id: virtualNetworkId },
      },
      name === "aks-north-prod"
        ? { dependsOn: [aksNorthNetwork.ready] }
        : undefined,
    );
  }

  const workspace = new operationalinsights.Workspace(
    "aks-production-workspace",
    {
      resourceGroupName: clusterGroup.name,
      workspaceName: "probono-law-aks-prod-law",
      location: "centralus",
      sku: { name: "PerGB2018" },
      retentionInDays: 30,
      tags: { Environment: "Production" },
    },
  );
  const prometheusWorkspace = new monitor.AzureMonitorWorkspace(
    "aks-production-prometheus-workspace",
    {
      resourceGroupName: clusterGroup.name,
      azureMonitorWorkspaceName: "probono-law-aks-prod-amw",
      // Azure Monitor workspaces are unavailable in North Central US.
      location: "centralus",
      publicNetworkAccess: "Enabled",
      tags: { Environment: "Production" },
    },
  );
  const identity = new managedidentity.UserAssignedIdentity(
    "aks-production-north-control-plane-identity",
    {
      resourceGroupName: clusterGroup.name,
      resourceName: "probono-law-aks-prod-northcentral-control-plane",
      location: "northcentralus",
    },
  );
  const principalId = identity.principalId.apply((value) => {
    if (!value) throw new Error("Production AKS identity is missing");
    return value;
  });
  const networkContributor = assign(
    "aks-production-subnet-network-contributor",
    subnet.id,
    principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.networkContributor}`,
  );
  const vnetReader = assign(
    "aks-production-vnet-reader",
    aksNorthNetwork.vnet.id,
    principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.reader}`,
  );
  const cluster = new containerservice.ManagedCluster(
    "aks-production-cluster",
    {
      resourceGroupName: clusterGroup.name,
      resourceName: "probono-law-aks-prod",
      location: "northcentralus",
      dnsPrefix: "probono-law-aks-prod",
      kubernetesVersion,
      enableRBAC: true,
      aadProfile: { managed: true, enableAzureRBAC: true, tenantID: tenantId },
      sku: { name: "Base", tier: "Standard" },
      identity: { type: "UserAssigned", userAssignedIdentities: [identity.id] },
      agentPoolProfiles: [
        {
          name: "nodepool1",
          mode: "System",
          type: "VirtualMachineScaleSets",
          vmSize: "Standard_D2as_v7",
          count: nodeMinCount,
          enableAutoScaling: true,
          minCount: nodeMinCount,
          maxCount: nodeMaxCount,
          maxPods: 250,
          osType: "Linux",
          osSKU: "Ubuntu",
          osDiskType: "Managed",
          vnetSubnetID: subnet.id,
        },
      ],
      networkProfile: {
        networkPlugin: "azure",
        networkPluginMode: "overlay",
        networkPolicy: "azure",
        podCidr: "10.244.0.0/16",
        serviceCidr: "10.1.0.0/16",
        dnsServiceIP: "10.1.0.10",
        loadBalancerSku: "standard",
        outboundType: "loadBalancer",
      },
      apiServerAccessProfile: { authorizedIPRanges: [operatorIpCidr] },
      oidcIssuerProfile: { enabled: true },
      securityProfile: { workloadIdentity: { enabled: true } },
      addonProfiles: {
        azureKeyvaultSecretsProvider: { enabled: true },
        omsagent: {
          enabled: true,
          config: {
            logAnalyticsWorkspaceResourceID: workspace.id,
            useAADAuth: "true",
          },
        },
      },
      azureMonitorProfile: {
        metrics: {
          enabled: true,
          kubeStateMetrics: {
            metricAnnotationsAllowList: "",
            metricLabelsAllowlist: "",
          },
        },
      },
      ingressProfile: {
        webAppRouting: {
          enabled: true,
          dnsZoneResourceIds: [zone.id],
          nginx: { defaultIngressControllerType: "Internal" },
        },
      },
      autoUpgradeProfile: { nodeOSUpgradeChannel: "NodeImage" },
      tags: { Environment: "Production" },
    },
    {
      dependsOn: [networkContributor, vnetReader, aksNorthNetwork.ready],
      protect: true,
      // The autoscaler changes nodepool1.count; the extra pool is managed below.
      ignoreChanges: ["agentPoolProfiles"],
    },
  );
  importAksOverflowPool(
    "aks-production-overflow-pool",
    new pulumi.Config("azure-native").require("subscriptionId"),
    "probono-law-aks-production",
    "probono-law-aks-prod",
    subnet.id,
    cluster,
  );
  assign(
    "aks-production-operator-cluster-admin",
    cluster.id,
    certificateOperatorPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.aksClusterAdmin}`,
    "User",
  );
  const kubeletPrincipalId = cluster.identityProfile.apply((profile) => {
    const objectId = profile?.kubeletidentity?.objectId;
    if (!objectId)
      throw new Error("Production AKS kubelet identity is missing");
    return objectId;
  });
  assign(
    "aks-production-registry-pull",
    registry.id,
    kubeletPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.acrPull}`,
  );
  const routingPrincipalId = cluster.ingressProfile.apply((profile) => {
    const objectId = profile?.webAppRouting?.identity?.objectId;
    if (!objectId)
      throw new Error("Production AKS routing identity is missing");
    return objectId;
  });
  assign(
    "aks-production-routing-dns-contributor",
    zone.id,
    routingPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.privateDnsZoneContributor}`,
  );
  assign(
    "aks-production-routing-certificate-reader",
    vault.id,
    routingPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.secretsUser}`,
  );
  return {
    cluster,
    clusterGroup,
    controlPlaneIdentity: identity,
    registry,
    vault,
    caVault,
    zone,
    workspace,
    prometheusWorkspace,
    subnet,
  };
}
