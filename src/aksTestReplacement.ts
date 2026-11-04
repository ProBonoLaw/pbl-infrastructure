import * as pulumi from "@pulumi/pulumi";
import {
  containerservice,
  keyvault,
  managedidentity,
  privatedns,
  resources,
} from "@pulumi/azure-native";
import { assign, roleIds } from "./core/iam";
import { createAksNorthNetwork } from "./aksNorthNetwork";
import { importAksOverflowPool } from "./aksOverflowPool";

const subscription = "00000000-0000-4000-8000-000000000003";
const vaultGroup = "probono-law-aks-prototype";

export function createTestAksReplacement(
  subscriptionId: pulumi.Input<string>,
  aksNorthNetwork: ReturnType<typeof createAksNorthNetwork>,
) {
  const clusterGroup = new resources.ResourceGroup("aks-test-north-group", {
    resourceGroupName: "probono-law-aks-test-northcentral",
    location: "northcentralus",
    tags: { Environment: "Test" },
  });
  const subnet = aksNorthNetwork.subnet;

  // Import the existing application vault and keep the replacement subnet
  // authorized for settings and server certificates.
  const vault = new keyvault.Vault(
    "aks-test-secrets-vault",
    {
      resourceGroupName: vaultGroup,
      vaultName: "probonolawakssecrets",
      location: "westcentralus",
      properties: {
        tenantId: "00000000-0000-4000-8000-00000000001c",
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
          ipRules: [{ value: "203.0.113.150/32" }],
          virtualNetworkRules: [{ id: subnet.id }],
        },
      },
    },
    {
      import: `/subscriptions/${subscription}/resourceGroups/${vaultGroup}/providers/Microsoft.KeyVault/vaults/probonolawakssecrets`,
      protect: true,
      retainOnDelete: true,
    },
  );

  const identity = new managedidentity.UserAssignedIdentity(
    "aks-test-north-control-plane-identity",
    {
      resourceGroupName: clusterGroup.name,
      resourceName: "probono-law-aks-test-northcentral-control-plane",
      location: "northcentralus",
    },
  );
  const principalId = identity.principalId.apply((value) => {
    if (!value) throw new Error("Test replacement AKS identity is missing");
    return value;
  });
  const networkContributor = assign(
    "aks-test-north-subnet-network-contributor",
    subnet.id,
    principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.networkContributor}`,
  );
  const vnetReader = assign(
    "aks-test-north-vnet-reader",
    aksNorthNetwork.vnet.id,
    principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.reader}`,
  );
  const zoneId = pulumi.interpolate`${subscriptionId}/resourceGroups/${vaultGroup}/providers/Microsoft.Network/privateDnsZones/internal.probono-law.com`;
  new privatedns.VirtualNetworkLink(
    "aks-test-north-internal-dns-link",
    {
      resourceGroupName: vaultGroup,
      privateZoneName: "internal.probono-law.com",
      virtualNetworkLinkName: "aks-northcentral",
      location: "global",
      registrationEnabled: false,
      virtualNetwork: { id: aksNorthNetwork.vnet.id },
    },
    { dependsOn: [aksNorthNetwork.ready] },
  );
  const workspaceId = pulumi.interpolate`${subscriptionId}/resourceGroups/${vaultGroup}/providers/Microsoft.OperationalInsights/workspaces/probono-law-aks-test-law`;
  const registryId = pulumi.interpolate`${subscriptionId}/resourceGroups/${vaultGroup}/providers/Microsoft.ContainerRegistry/registries/probonolawservices`;
  const cluster = new containerservice.ManagedCluster(
    "aks-test-north-cluster",
    {
      resourceGroupName: clusterGroup.name,
      resourceName: "probono-law-aks-test-nc",
      location: "northcentralus",
      dnsPrefix: "probono-law-aks-test-nc",
      kubernetesVersion: "1.35",
      enableRBAC: true,
      aadProfile: {
        managed: true,
        enableAzureRBAC: true,
        tenantID: "00000000-0000-4000-8000-00000000001c",
      },
      sku: { name: "Base", tier: "Free" },
      identity: { type: "UserAssigned", userAssignedIdentities: [identity.id] },
      agentPoolProfiles: [
        {
          name: "nodepool1",
          mode: "System",
          type: "VirtualMachineScaleSets",
          vmSize: "Standard_D2as_v7",
          count: 4,
          enableAutoScaling: true,
          minCount: 4,
          maxCount: 6,
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
      apiServerAccessProfile: { authorizedIPRanges: ["203.0.113.150/32"] },
      oidcIssuerProfile: { enabled: true },
      securityProfile: { workloadIdentity: { enabled: true } },
      addonProfiles: {
        azureKeyvaultSecretsProvider: { enabled: true },
        omsagent: {
          enabled: true,
          config: {
            logAnalyticsWorkspaceResourceID: workspaceId,
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
          dnsZoneResourceIds: [zoneId],
          nginx: { defaultIngressControllerType: "Internal" },
        },
      },
      autoUpgradeProfile: { nodeOSUpgradeChannel: "NodeImage" },
      tags: { Environment: "Test" },
    },
    {
      dependsOn: [networkContributor, vnetReader, aksNorthNetwork.ready],
      protect: true,
      // The autoscaler changes nodepool1.count; the extra pool is managed below.
      ignoreChanges: ["agentPoolProfiles"],
    },
  );
  importAksOverflowPool(
    "aks-test-north-overflow-pool",
    subscription,
    "probono-law-aks-test-northcentral",
    "probono-law-aks-test-nc",
    subnet.id,
    cluster,
  );
  const issuer = cluster.oidcIssuerProfile.apply((profile) => {
    const url = profile?.issuerURL;
    if (!url) throw new Error("Test replacement AKS OIDC issuer is missing");
    return url;
  });
  for (const [identityName, subject] of [
    ["file-operations-test-workload", "file-operations:file-operations"],
    [
      "billing-operations-test-workload",
      "billing-operations:billing-operations",
    ],
    ["aimie-operations-test-workload", "aimie-operations:aimie-operations"],
    ["email-operations-test-workload", "email-operations:email-operations"],
    [
      "account-operations-test-workload",
      "account-operations:account-operations",
    ],
    [
      "account-operations-email-test-workload",
      "account-operations:account-operations-email",
    ],
    [
      "account-operations-resource-manager-test-workload",
      "account-operations:resource-manager",
    ],
    [
      "account-operations-sharepoint-site-starter-test-workload",
      "account-operations:sharepoint-site-starter",
    ],
    ["markdown-converter-test-workload", "aimie-operations:markdown-converter"],
    ["aimie-service-test-workload", "aimie-operations:aimie-service"],
  ] as const) {
    new managedidentity.FederatedIdentityCredential(
      `aks-test-north-${identityName}-federation`,
      {
        resourceGroupName: vaultGroup,
        resourceName: identityName,
        federatedIdentityCredentialResourceName: "aks-test-northcentral",
        issuer,
        subject: `system:serviceaccount:${subject}`,
        audiences: ["api://AzureADTokenExchange"],
      },
    );
  }
  const clusterAdmins = [
    ["operator", "00000000-0000-4000-8000-000000000001"],
    ["deployment-manager", "00000000-0000-4000-8000-000000000019"],
    ["aimie-operations-ci", "00000000-0000-4000-8000-00000000001d"],
    ["email-operations-ci", "00000000-0000-4000-8000-00000000001e"],
    ["account-operations-ci", "00000000-0000-4000-8000-00000000001f"],
    ["aimie-service-ci", "00000000-0000-4000-8000-000000000020"],
  ] as const;
  for (const [name, principal] of clusterAdmins) {
    assign(
      `aks-test-north-${name}-cluster-admin`,
      cluster.id,
      principal,
      pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.aksClusterAdmin}`,
      name === "operator" ? "User" : "ServicePrincipal",
    );
    if (name !== "operator") {
      assign(
        `aks-test-north-${name}-contributor`,
        cluster.id,
        principal,
        pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.aksContributor}`,
      );
    }
  }
  const kubeletPrincipalId = cluster.identityProfile.apply((profile) => {
    const objectId = profile?.kubeletidentity?.objectId;
    if (!objectId)
      throw new Error("Test replacement kubelet identity is missing");
    return objectId;
  });
  assign(
    "aks-test-north-registry-pull",
    registryId,
    kubeletPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.acrPull}`,
  );
  const routingPrincipalId = cluster.ingressProfile.apply((profile) => {
    const objectId = profile?.webAppRouting?.identity?.objectId;
    if (!objectId)
      throw new Error("Test replacement routing identity is missing");
    return objectId;
  });
  assign(
    "aks-test-north-routing-dns-contributor",
    zoneId,
    routingPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.privateDnsZoneContributor}`,
  );
  assign(
    "aks-test-north-routing-certificate-reader",
    vault.id,
    routingPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.secretsUser}`,
  );
  return {
    cluster,
    clusterGroup,
    controlPlaneIdentity: identity,
    registry: { id: registryId },
    vault,
    subnet,
  };
}
