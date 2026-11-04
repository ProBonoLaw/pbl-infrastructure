import * as dataAutomation from "./aimie-data-automation";
import * as resourceManager from "./resource-manager";
import * as markdownConverter from "./markdown-html-converter";
import * as portalStarter from "./portal-starter";
import * as aimieNotification from "./aimie-notification";
import * as dataIntegrityExtractor from "./data-integrity-extractor";
import * as dataIngestion from "./data-ingestion-service";
import * as probonoPortal from "./probonolaw-portal";
import * as aimie from "./aimie";

/** Retained service data, networking, and the portal Web App. */
export const serviceModules = [
  dataAutomation,
  resourceManager,
  markdownConverter,
  portalStarter,
  aimieNotification,
  dataIntegrityExtractor,
  dataIngestion,
  probonoPortal,
  aimie,
] as const;

export function getServiceModules(environmentName: string) {
  if (environmentName !== "Test") return serviceModules;
  return serviceModules.filter(
    (service) =>
      service.key !== "portalStarter" &&
      service.key !== "resourceManager" &&
      service.key !== "markdownConverter",
  );
}
