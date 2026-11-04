import * as pulumi from "@pulumi/pulumi";
import { dashboard, managedidentity, resources } from "@pulumi/azure-native";
import { assign, roleIds } from "./core/iam";
import { createAksPlatform } from "./aksPlatform";

const testGrafanaId =
  "/subscriptions/00000000-0000-4000-8000-000000000003/resourceGroups/defaultresourcegroup-scus/providers/Microsoft.Dashboard/grafana/grafana-202691141356-sc";
const testEditorAssignmentId = `${testGrafanaId}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-4000-8000-00000000001a`;

export function configureGrafana(
  environmentName: string,
  subscriptionId: pulumi.Input<string>,
  aksPlatform: ReturnType<typeof createAksPlatform>,
) {
  const editorRole = pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.grafanaEditor}`;
  if (environmentName === "Test") {
    assign(
      "grafana-test-deployment-editor",
      testGrafanaId,
      "00000000-0000-4000-8000-000000000019",
      editorRole,
      "ServicePrincipal",
      testEditorAssignmentId,
    );
    return;
  }

  if (!aksPlatform || !("prometheusWorkspace" in aksPlatform))
    throw new Error("Production AKS workspace is missing");
  const group = new resources.ResourceGroup("grafana-production-group", {
    resourceGroupName: "probono-law-grafana-production",
    location: "southcentralus",
    tags: { Environment: "Production" },
  });
  const grafana = new dashboard.Grafana(
    "grafana-production",
    {
      workspaceName: "probonolaw-grafana-prod",
      resourceGroupName: group.name,
      location: group.location,
      sku: { name: "Standard" },
      identity: { type: "SystemAssigned" },
      properties: {
        apiKey: "Disabled",
        publicNetworkAccess: "Enabled",
        grafanaMajorVersion: "12",
        grafanaIntegrations: {
          azureMonitorWorkspaceIntegrations: [
            {
              azureMonitorWorkspaceResourceId:
                aksPlatform.prometheusWorkspace.id,
            },
          ],
        },
      },
      tags: { Environment: "Production" },
    },
    { protect: true },
  );
  assign(
    "grafana-production-deployment-editor",
    grafana.id,
    "00000000-0000-4000-8000-000000000014",
    editorRole,
  );
  // The File Operations repository uses its own OIDC identity to publish the
  // ingestion dashboards; the infrastructure deployment identity is separate.
  const fileOperationsCi = managedidentity.getUserAssignedIdentityOutput({
    resourceGroupName: "probono-law-aks-production",
    resourceName: "file-operations-ci-prod",
  });
  assign(
    "grafana-production-file-operations-editor",
    grafana.id,
    fileOperationsCi.principalId,
    editorRole,
  );
  assign(
    "grafana-production-file-operations-reader",
    grafana.id,
    fileOperationsCi.principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.reader}`,
  );
  const grafanaPrincipalId = grafana.identity.apply((identity) => {
    if (!identity?.principalId)
      throw new Error("Production Grafana managed identity is missing");
    return identity.principalId;
  });
  assign(
    "grafana-production-logs-reader",
    pulumi.interpolate`${subscriptionId}/resourceGroups/aimie-data-automation/providers/Microsoft.OperationalInsights/workspaces/aimie-data-automationwsvdqzxqu4`,
    grafanaPrincipalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.analyticsReader}`,
  );
}
