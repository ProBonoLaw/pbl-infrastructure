import * as pulumi from "@pulumi/pulumi";
import { keyvault, resources } from "@pulumi/azure-native";
import { createFoundation } from "./foundation";
import { armUniqueString } from "./naming";
import { createPrivateEndpoint } from "./privateEndpoint";
import type { Subnets } from "./subnets";

export function createKeyVaults(
  foundation: ReturnType<typeof createFoundation>,
  groups: Record<string, resources.ResourceGroup>,
  subnets: Subnets,
  environmentName: string,
) {
  const customerName = pulumi.interpolate`customeraccount${armUniqueString("customer-kv-group", groups["customer-account-kv"].id).apply((value) => value.slice(0, 8))}`;
  const onboardingName = pulumi.interpolate`onboardingdpl${armUniqueString("onboarding-kv-group", groups["onboarding-dpl"].id).apply((value) => value.slice(0, 8))}`;
  const vaultProperties: keyvault.VaultArgs["properties"] = {
    sku: { family: "A", name: "standard" },
    tenantId: "00000000-0000-4000-8000-00000000001c",
    networkAcls: {
      bypass: "None",
      defaultAction: "Deny",
      ipRules: [{ value: "203.0.113.151/32" }],
    },
    enabledForDeployment: false,
    enabledForDiskEncryption: false,
    enabledForTemplateDeployment: false,
    enableSoftDelete: true,
    softDeleteRetentionInDays: 90,
    enableRbacAuthorization: true,
    publicNetworkAccess: "Enabled",
  };
  const customer = new keyvault.Vault("customer-account-vault", {
    vaultName: customerName,
    resourceGroupName: groups["customer-account-kv"].name,
    location: "centralus",
    tags: {
      Environment:
        environmentName === "Production" ? "Development" : environmentName,
    },
    properties: vaultProperties,
  });
  const onboarding = new keyvault.Vault("onboarding-vault", {
    vaultName: onboardingName,
    resourceGroupName: groups["onboarding-dpl"].name,
    location: "centralus",
    properties: {
      ...vaultProperties,
      networkAcls: {
        bypass: "None",
        defaultAction: "Deny",
        ipRules:
          environmentName === "Test"
            ? [{ value: "203.0.113.151/32" }]
            : undefined,
      },
    },
  });
  const zoneName = "privatelink.vaultcore.azure.net";
  createPrivateEndpoint(
    "customer-vault-logic-pe",
    "aks-nc-customer-vault-pe",
    groups["customer-account-kv"],
    "northcentralus",
    subnets["aks/private-endpoints"],
    customer.id,
    ["vault"],
    zoneName,
    foundation.dnsZones.logic[zoneName].id,
    {},
    [],
    "default",
  );
  createPrivateEndpoint(
    "onboarding-vault-logic-pe",
    "aks-nc-onboarding-vault-pe",
    groups["onboarding-dpl"],
    "northcentralus",
    subnets["aks/private-endpoints"],
    onboarding.id,
    ["vault"],
    zoneName,
    foundation.dnsZones.logic[zoneName].id,
    {},
    [],
    "default",
  );
  return { customer, onboarding };
}
