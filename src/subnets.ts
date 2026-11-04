import { network } from "@pulumi/azure-native";

export type Subnets = Record<string, network.Subnet>;
