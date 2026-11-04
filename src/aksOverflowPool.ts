import * as pulumi from "@pulumi/pulumi";
import { containerservice } from "@pulumi/azure-native";

/** Adopt the existing user pool used for overflow capacity. */
export function importAksOverflowPool(
  logicalName: string,
  subscriptionId: string,
  resourceGroupName: string,
  clusterName: string,
  subnetId: pulumi.Input<string>,
  cluster: containerservice.ManagedCluster,
) {
  return new containerservice.AgentPool(
    logicalName,
    {
      resourceGroupName,
      resourceName: clusterName,
      agentPoolName: "deployv6",
      mode: "User",
      type: "VirtualMachineScaleSets",
      vmSize: "Standard_D2as_v6",
      count: 2,
      enableAutoScaling: true,
      minCount: 2,
      maxCount: 4,
      enableEncryptionAtHost: false,
      enableFIPS: false,
      enableNodePublicIP: false,
      enableUltraSSD: false,
      kubeletDiskType: "OS",
      maxPods: 250,
      orchestratorVersion: "1.35",
      osType: "Linux",
      osSKU: "Ubuntu",
      osDiskType: "Managed",
      osDiskSizeGB: 128,
      powerState: { code: "Running" },
      scaleDownMode: "Delete",
      securityProfile: {
        enableSecureBoot: false,
        enableVTPM: false,
        sshAccess: "LocalUser",
      },
      upgradeSettings: {
        maxSurge: "10%",
        maxUnavailable: "0",
        undrainableNodeBehavior: "Schedule",
      },
      vnetSubnetID: subnetId,
    },
    {
      import: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${clusterName}/agentPools/deployv6`,
      dependsOn: [cluster],
      protect: true,
      retainOnDelete: true,
    },
  );
}
