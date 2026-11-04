import { resources, storage } from "@pulumi/azure-native";
import * as pulumi from "@pulumi/pulumi";

type AccountOptions = Partial<storage.StorageAccountArgs> & {
  subnetIds?: pulumi.Input<string>[];
  fileShareName?: storage.FileShareArgs["shareName"];
  fileShareRetentionDays?: number;
  retainedBlobs?: boolean;
  containers?: string[];
  geoRedundant?: boolean;
  allowedIpRanges?: string[];
};

export const networkRules = (
  subnetIds: pulumi.Input<string>[],
  defaultAction: "Allow" | "Deny",
) => ({
  bypass: "AzureServices" as const,
  defaultAction,
  ...(subnetIds.length
    ? {
        virtualNetworkRules: subnetIds.map((id) => ({
          virtualNetworkResourceId: id,
          action: "Allow" as const,
        })),
      }
    : {}),
});

export function createAccount(
  logicalName: string,
  group: resources.ResourceGroup,
  accountName: pulumi.Input<string>,
  location: string,
  environmentName: string,
  options: AccountOptions = {},
) {
  const {
    subnetIds,
    fileShareName,
    fileShareRetentionDays = 7,
    retainedBlobs,
    containers,
    geoRedundant = false,
    allowedIpRanges,
    ...nativeOverrides
  } = options;
  const skuName = geoRedundant ? "Standard_RAGRS" : "Standard_LRS";
  const account = new storage.StorageAccount(
    logicalName,
    {
      accountName,
      resourceGroupName: group.name,
      location,
      tags: { Environment: environmentName },
      sku: { name: skuName },
      kind: "StorageV2",
      dnsEndpointType: geoRedundant ? "Standard" : undefined,
      defaultToOAuthAuthentication: true,
      publicNetworkAccess: "Enabled",
      allowCrossTenantReplication: false,
      minimumTlsVersion: "TLS1_2",
      allowBlobPublicAccess: false,
      allowSharedKeyAccess: true,
      largeFileSharesState: geoRedundant ? "Enabled" : undefined,
      networkRuleSet: {
        ...networkRules(subnetIds ?? [], "Deny"),
        ...(allowedIpRanges?.length
          ? {
              ipRules: allowedIpRanges.map((iPAddressOrRange) => ({
                iPAddressOrRange,
                action: "Allow" as const,
              })),
            }
          : {}),
      },
      enableHttpsTrafficOnly: true,
      encryption: {
        requireInfrastructureEncryption: geoRedundant ? false : undefined,
        keySource: "Microsoft.Storage",
        services: {
          file: { keyType: "Account", enabled: true },
          blob: { keyType: "Account", enabled: true },
        },
      },
      accessTier: "Hot",
      ...nativeOverrides,
    },
    {
      ignoreChanges: (subnetIds ?? []).map(
        (_, index) => `networkRuleSet.virtualNetworkRules[${index}].state`,
      ),
    },
  );
  const retainBlobData = retainedBlobs ?? geoRedundant;
  new storage.BlobServiceProperties(`${logicalName}-blob`, {
    accountName: account.name,
    resourceGroupName: group.name,
    blobServicesName: "default",
    containerDeleteRetentionPolicy: retainBlobData
      ? { enabled: true, days: 7 }
      : undefined,
    deleteRetentionPolicy: retainBlobData
      ? { allowPermanentDelete: false, enabled: true, days: 7 }
      : { allowPermanentDelete: false, enabled: false },
  });
  const fileService = new storage.FileServiceProperties(`${logicalName}-file`, {
    accountName: account.name,
    resourceGroupName: group.name,
    fileServicesName: "default",
    shareDeleteRetentionPolicy: { enabled: true, days: fileShareRetentionDays },
  });
  if (!geoRedundant) {
    new storage.QueueServiceProperties(`${logicalName}-queue`, {
      accountName: account.name,
      resourceGroupName: group.name,
      queueServiceName: "default",
    });
    new storage.TableServiceProperties(`${logicalName}-table`, {
      accountName: account.name,
      resourceGroupName: group.name,
      tableServiceName: "default",
    });
  }
  for (const containerName of containers ?? []) {
    new storage.BlobContainer(`${logicalName}-${containerName}`, {
      accountName: account.name,
      resourceGroupName: group.name,
      containerName,
      immutableStorageWithVersioning: { enabled: false },
      defaultEncryptionScope: "$account-encryption-key",
      denyEncryptionScopeOverride: false,
      publicAccess: "None",
    });
  }
  if (fileShareName) {
    new storage.FileShare(
      `${logicalName}-share`,
      {
        accountName: account.name,
        resourceGroupName: group.name,
        shareName: fileShareName,
        accessTier: "TransactionOptimized",
        shareQuota: 102400,
      },
      { dependsOn: [fileService] },
    );
  }
  return account;
}
