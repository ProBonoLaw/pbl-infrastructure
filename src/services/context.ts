import * as pulumi from "@pulumi/pulumi";
import { network, resources, storage, web } from "@pulumi/azure-native";
import { createFoundation } from "../foundation";
import { createTelemetryAndPlans } from "../telemetry";
import { createVideoIndexer } from "../videoIndexer";

/** References shared by service modules; Azure resource types come from Azure Native. */
export interface ServiceContext {
  environmentName: string;
  keepLegacyPortalWebApp: boolean;
  subscriptionId: pulumi.Input<string>;
  foundation: ReturnType<typeof createFoundation>;
  subnets: Record<string, network.Subnet>;
  groups: Record<string, resources.ResourceGroup>;
  accounts: Record<string, storage.StorageAccount>;
  telemetry: ReturnType<typeof createTelemetryAndPlans>;
  apps: Record<string, web.WebApp>;
  videoIndexer: ReturnType<typeof createVideoIndexer>;
}
