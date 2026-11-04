import * as pulumi from "@pulumi/pulumi";
import { authorization, keyvault, privatedns } from "@pulumi/azure-native";
import { assign, roleIds } from "./core/iam";

export function configureTestAksMarkdownTlsDns(
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
) {
  if (environmentName !== "Test") return;

  const resourceGroupName = "probono-law-aks-prototype";
  const privateZoneName = "internal.probono-law.com";
  const caVault = new keyvault.Vault(
    "aks-test-internal-ca-vault",
    {
      resourceGroupName,
      vaultName: "probonolawtestca",
      location: "westcentralus",
      properties: {
        tenantId: "00000000-0000-4000-8000-00000000001c",
        sku: { family: "A", name: "standard" },
        enableRbacAuthorization: true,
        enablePurgeProtection: true,
        enableSoftDelete: true,
        softDeleteRetentionInDays: 90,
        publicNetworkAccess: "Enabled",
        enabledForDeployment: false,
        enabledForDiskEncryption: false,
        enabledForTemplateDeployment: false,
        networkAcls: {
          bypass: "None",
          defaultAction: "Deny",
          ipRules: [{ value: "203.0.113.150/32" }],
        },
      },
    },
    {
      import:
        "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/probono-law-aks-prototype/providers/Microsoft.KeyVault/vaults/probonolawtestca",
      protect: true,
      retainOnDelete: true,
    },
  );
  new authorization.ManagementLockByScope(
    "aks-test-internal-ca-vault-deletion-lock",
    {
      scope: caVault.id,
      lockName: "protect-probonolawtestca",
      level: "CanNotDelete",
      notes: "Preserve Test internal CA private key during AKS rebuilds",
    },
    {
      import:
        "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/probono-law-aks-prototype/providers/Microsoft.KeyVault/vaults/probonolawtestca/providers/Microsoft.Authorization/locks/protect-probonolawtestca",
      protect: true,
      retainOnDelete: true,
    },
  );
  assign(
    "aks-test-internal-ca-certificate-officer",
    caVault.id,
    "00000000-0000-4000-8000-000000000001",
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.certificateOfficer}`,
    "User",
    "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/probono-law-aks-prototype/providers/Microsoft.KeyVault/vaults/probonolawtestca/providers/Microsoft.Authorization/roleAssignments/00000000-0000-4000-8000-000000000021",
  );
  new privatedns.PrivateZone(
    "aks-test-internal-probono-law-zone",
    {
      resourceGroupName,
      privateZoneName,
      location: "global",
    },
    {
      import:
        "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/probono-law-aks-prototype/providers/Microsoft.Network/privateDnsZones/internal.probono-law.com",
    },
  );
}
