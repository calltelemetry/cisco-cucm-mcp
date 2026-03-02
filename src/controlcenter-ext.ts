import { resolveAuth, resolveTarget, type DimeAuth } from "./dime.js";
import { escapeXml, fetchServiceabilitySoap, toArray } from "./soap.js";

// ControlCenterServices (regular) — for start/stop/restart
const CC_PATH = "/controlcenterservice2/services/ControlCenterServices";
// ControlCenterServicesEx (extended) — for enriched service list
const CC_EXT_PATH = "/controlcenterservice2/services/ControlCenterServicesEx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceControlResult = {
  serviceName: string;
  serviceStatus: string;
  reasonCode: number;
  reasonCodeString: string;
};

export type StaticServiceInfoExtended = {
  serviceName: string;
  serviceType: string;
  deployable: boolean;
  groupName: string;
  serviceEnum: string;
};

// ---------------------------------------------------------------------------
// SOAP envelopes
// ---------------------------------------------------------------------------

/**
 * Build envelope for `soapDoControlServices` (regular endpoint).
 * ControlType: "Start" | "Stop" | "Restart"
 */
function buildControlServicesEnvelope(
  controlType: "Start" | "Stop" | "Restart",
  serviceNames: string[],
  nodeName: string,
): string {
  const items = serviceNames.map((n) => `<soap:item>${escapeXml(n)}</soap:item>`).join("");

  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:soapDoControlServices>" +
    "<soap:ControlServiceRequest>" +
    `<soap:NodeName>${escapeXml(nodeName)}</soap:NodeName>` +
    `<soap:ControlType>${controlType}</soap:ControlType>` +
    `<soap:ServiceList>${items}</soap:ServiceList>` +
    "</soap:ControlServiceRequest>" +
    "</soap:soapDoControlServices>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function buildGetStaticServiceListExtendedEnvelope(): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:getStaticServiceListExtended>" +
    "<soap:ServiceInformationResponse></soap:ServiceInformationResponse>" +
    "</soap:getStaticServiceListExtended>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

// ---------------------------------------------------------------------------
// Service control operations (via regular ControlCenterServices endpoint)
// ---------------------------------------------------------------------------

async function doControlServices(
  controlType: "Start" | "Stop" | "Restart",
  hostOrUrl: string,
  serviceNames: string[],
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<ServiceControlResult[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildControlServicesEnvelope(controlType, serviceNames, target.host);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    CC_PATH,
    "soapDoControlServices",
    envelope,
    timeoutMs ?? 60_000,
  );

  const resp = body.soapDoControlServicesResponse as Record<string, unknown> | undefined;
  const ret = resp?.soapDoControlServicesReturn as Record<string, unknown> | undefined;
  const serviceList = ret?.ServiceInfoList as Record<string, unknown> | undefined;
  const items = toArray(serviceList?.item) as Record<string, unknown>[];

  return items.map((svc) => ({
    serviceName: String(svc.ServiceName ?? ""),
    serviceStatus: String(svc.ServiceStatus ?? ""),
    reasonCode: Number(svc.ReasonCode ?? 0),
    reasonCodeString: String(svc.ReasonCodeString ?? ""),
  }));
}

export async function startService(
  hostOrUrl: string,
  serviceNames: string[],
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<ServiceControlResult[]> {
  return doControlServices("Start", hostOrUrl, serviceNames, auth, port, timeoutMs);
}

export async function stopService(
  hostOrUrl: string,
  serviceNames: string[],
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<ServiceControlResult[]> {
  return doControlServices("Stop", hostOrUrl, serviceNames, auth, port, timeoutMs);
}

export async function restartService(
  hostOrUrl: string,
  serviceNames: string[],
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<ServiceControlResult[]> {
  return doControlServices("Restart", hostOrUrl, serviceNames, auth, port, timeoutMs);
}

// ---------------------------------------------------------------------------
// Extended static service list (via ControlCenterServicesEx endpoint)
// ---------------------------------------------------------------------------

export async function getStaticServiceListExtended(
  hostOrUrl: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<StaticServiceInfoExtended[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildGetStaticServiceListExtendedEnvelope();

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    CC_EXT_PATH,
    "getStaticServiceListExtended",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.getStaticServiceListExtendedResponse as Record<string, unknown> | undefined;
  const ret = resp?.getStaticServiceListExtendedReturn as Record<string, unknown> | undefined;
  const services = ret?.Services as Record<string, unknown> | undefined;
  const items = toArray(services?.item) as Record<string, unknown>[];

  return items.map((svc) => ({
    serviceName: String(svc.ServiceName ?? ""),
    serviceType: String(svc.ServiceType ?? ""),
    deployable: svc.Deployable === true || String(svc.Deployable) === "true",
    groupName: String(svc.GroupName ?? ""),
    serviceEnum: String(svc.ServiceEnum ?? ""),
  }));
}
