import { resolveAuth, resolveTarget, type DimeAuth } from "./dime.js";
import { escapeXml, fetchServiceabilitySoap, toArray } from "./soap.js";

const CC_PATH = "/controlcenterservice2/services/ControlCenterServices";

export type ServiceInfo = {
  serviceName: string;
  serviceStatus: string;
  reasonCode: number;
  reasonCodeString: string;
  startTime: string;
  upTime: number;
  upTimeString: string;
};

function buildGetServiceStatusEnvelope(serviceNames?: string[]): string {
  const items =
    serviceNames?.length
      ? serviceNames.map((n) => `<soap:item>${escapeXml(n)}</soap:item>`).join("")
      : "";

  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:soapGetServiceStatus>" +
    `<soap:ServiceStatus>${items}</soap:ServiceStatus>` +
    "</soap:soapGetServiceStatus>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

export async function getServiceStatus(
  hostOrUrl: string,
  serviceNames?: string[],
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<ServiceInfo[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildGetServiceStatusEnvelope(serviceNames);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    CC_PATH,
    "soapGetServiceStatus",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.soapGetServiceStatusResponse as Record<string, unknown> | undefined;
  const ret = resp?.soapGetServiceStatusReturn as Record<string, unknown> | undefined;
  const serviceList = ret?.ServiceInfoList as Record<string, unknown> | undefined;
  const items = toArray(serviceList?.item ?? serviceList?.ServiceInformation) as Record<string, unknown>[];

  return items.map((svc) => ({
    serviceName: String(svc.ServiceName ?? ""),
    serviceStatus: String(svc.ServiceStatus ?? ""),
    reasonCode: Number(svc.ReasonCode ?? 0),
    reasonCodeString: String(svc.ReasonCodeString ?? ""),
    startTime: String(svc.StartTime ?? ""),
    upTime: Number(svc.UpTime ?? 0),
    upTimeString: String(svc.UpTimeString ?? ""),
  }));
}
