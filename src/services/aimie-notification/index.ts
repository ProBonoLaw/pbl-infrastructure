import * as pulumi from "@pulumi/pulumi";
import { resources } from "@pulumi/azure-native";
import { armUniqueString } from "../../naming";
import { createPrivateEndpoint } from "../../privateEndpoint";
import type { ServiceContext } from "../context";

export const key = "aimieNotification";
export const groupName = "aimie-notification";
export const groupLocation = "westcentralus";
export const telemetryDefinition = {
  key: "aimieNotification",
  groupName: "aimie-notification",
  workspacePrefix: "aimie-notificationws",
  insightPrefix: "aimie-notificationappinsights",
  telemetryLocation: "centralus",
  insightTagged: false,
  testInsightOverrides: { disableLocalAuth: undefined },
  productionInsightOverrides: { disableLocalAuth: undefined },
};
export function createGroup(
  groups: ServiceContext["groups"],
  environmentName: string,
) {
  groups[groupName] = new resources.ResourceGroup(groupName, {
    resourceGroupName: groupName,
    location: groupLocation,
    tags: {
      Environment:
        environmentName === "Production" ? "AzureCloud" : environmentName,
    },
  });
}

export function createAdditionalResources(ctx: ServiceContext) {
  const { foundation, groups, subnets, environmentName } = ctx;
  const notificationGroup = groups["aimie-notification"];
  const notificationSuffix = armUniqueString(
    "aimie-notification-rg",
    notificationGroup.id,
  );
  const pubSubName = pulumi.interpolate`aimienotificationpubsub${notificationSuffix.apply((suffix) => suffix.slice(0, 8))}`;
  // Azure assigns this suffix to the retained aks-nc-webpubsub-pe connection.
  // Preserve its ACL when the ARM deployment is reapplied. Endpoint replacement
  // must update the connection suffix here after its new connection is approved.
  const connectionSuffix =
    environmentName === "Test"
      ? "00000000-0000-4000-8000-000000000011"
      : "00000000-0000-4000-8000-000000000012";

  // The default Azure Native provider has no WebPubSub resource. The native
  // Resources deployment keeps the required API version and uses Incremental mode.
  const pubSubDeployment = new resources.Deployment(
    "aimie-notification-webpubsub",
    {
      deploymentName: "pulumi-aimie-notification-webpubsub",
      resourceGroupName: notificationGroup.name,
      properties: {
        mode: "Incremental",
        parameters: {
          name: { value: pubSubName },
          privateEndpointConnectionName: {
            value: pulumi.interpolate`${pubSubName}.${connectionSuffix}`,
          },
          environmentName: {
            value:
              environmentName === "Production" ? "AzureCloud" : environmentName,
          },
        },
        template: {
          $schema:
            "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
          contentVersion: "1.0.0.0",
          parameters: {
            name: { type: "string" },
            privateEndpointConnectionName: { type: "string" },
            environmentName: { type: "string" },
          },
          resources: [
            {
              type: "Microsoft.SignalRService/WebPubSub",
              apiVersion: "2025-01-01-preview",
              name: "[parameters('name')]",
              location: "centralus",
              tags: { Environment: "[parameters('environmentName')]" },
              sku: {
                name: "Premium_P1",
                tier: "Premium",
                size: "P1",
                capacity: 1,
              },
              kind: "WebPubSub",
              properties: {
                tls: { clientCertEnabled: false },
                networkACLs: {
                  defaultAction: "Deny",
                  privateEndpoints: [
                    {
                      name: "[parameters('privateEndpointConnectionName')]",
                      allow: [
                        "ServerConnection",
                        "ClientConnection",
                        "RESTAPI",
                        "Trace",
                      ],
                    },
                  ],
                  publicNetwork: {
                    allow: [
                      "ServerConnection",
                      "ClientConnection",
                      "RESTAPI",
                      "Trace",
                    ],
                  },
                  ipRules: [
                    { value: "0.0.0.0/0", action: "Allow" },
                    { value: "::/0", action: "Allow" },
                  ],
                },
                applicationFirewall: {
                  clientConnectionCountRules: [],
                  clientTrafficControlRules: [],
                },
                publicNetworkAccess: "Enabled",
                disableLocalAuth: false,
                disableAadAuth: false,
                regionEndpointEnabled: "Enabled",
                resourceStopped: "false",
              },
            },
          ],
        },
      },
    },
  );
  const pubSubId = pulumi.interpolate`${notificationGroup.id}/providers/Microsoft.SignalRService/webPubSub/${pubSubName}`;
  const pubSubZone = "privatelink.webpubsub.azure.com";
  createPrivateEndpoint(
    "aimie-notification-webpubsub-pe",
    "aks-nc-webpubsub-pe",
    notificationGroup,
    "northcentralus",
    subnets["aks/private-endpoints"],
    pubSubId,
    ["webpubsub"],
    pubSubZone,
    foundation.dnsZones.logic[pubSubZone].id,
    { dependsOn: [pubSubDeployment] },
    [],
    "default",
  );

  return { notificationWebPubSubId: pubSubId };
}
