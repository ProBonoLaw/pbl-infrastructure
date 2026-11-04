import * as pulumi from "@pulumi/pulumi";
import { privatedns, resources } from "@pulumi/azure-native";

export const privateDnsZoneNames = [
  "privatelink.azurewebsites.net",
  "privatelink.blob.core.windows.net",
  "privatelink.cognitiveservices.azure.com",
  "privatelink.documents.azure.com",
  "privatelink.file.core.windows.net",
  "privatelink.queue.core.windows.net",
  "privatelink.search.windows.net",
  "privatelink.servicebus.windows.net",
  "privatelink.table.core.windows.net",
  "privatelink.webpubsub.azure.com",
  "privatelink.vaultcore.azure.net",
  "privatelink.openai.azure.com",
  "privatelink.services.ai.azure.com",
  "privatelink.api.videoindexer.ai",
] as const;

export function createFoundation() {
  const subscriptionId = new pulumi.Config("azure-native").require(
    "subscriptionId",
  );
  const logicDnsGroup = new resources.ResourceGroup(
    "data-ingestion-logic-apps-dns-zones",
    {
      resourceGroupName: "data-ingestion-logic-apps-dns-zones",
      location: "westcentralus",
    },
  );

  const dnsZones: { logic: Record<string, privatedns.PrivateZone> } = {
    logic: {},
  };
  for (const zoneName of privateDnsZoneNames) {
    const safeName = zoneName.replace(/[^a-zA-Z0-9]/g, "-");
    const zone = new privatedns.PrivateZone(`logic-${safeName}`, {
      resourceGroupName: logicDnsGroup.name,
      privateZoneName: zoneName,
      location: "global",
    });
    dnsZones.logic[zoneName] = zone;
    // New zones get their SOA record from Azure when the zone is created.
    // Existing zones retain their imported records until they are retired.
    if (zoneName !== "privatelink.services.ai.azure.com") {
      new privatedns.PrivateRecordSet(
        `logic-${safeName}-soa`,
        {
          resourceGroupName: logicDnsGroup.name,
          privateZoneName: zone.name,
          relativeRecordSetName: "@",
          recordType: "SOA",
          ttl: 3600,
          soaRecord: {
            email: "azureprivatedns-host.microsoft.com",
            expireTime: 2419200,
            host: "azureprivatedns.net",
            minimumTtl: 10,
            refreshTime: 3600,
            retryTime: 300,
            serialNumber: 1,
          },
        },
        // Azure owns the SOA lifecycle and rejects direct deletion. Forget the
        // imported record when its parent zone is retired; Azure deletes it.
        {
          import: `/subscriptions/${subscriptionId}/resourceGroups/data-ingestion-logic-apps-dns-zones/providers/Microsoft.Network/privateDnsZones/${zoneName}/SOA/@`,
          retainOnDelete: true,
        },
      );
    }
  }

  return {
    logicDnsGroup,
    dnsZones,
  };
}
