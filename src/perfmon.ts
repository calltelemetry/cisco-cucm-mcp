import { resolveAuth, resolveTarget, type DimeAuth } from "./dime.js";
import { escapeXml, fetchServiceabilitySoap, toArray } from "./soap.js";

const PERFMON_PATH = "/perfmonservice2/services/PerfmonService";

export type PerfmonCounterValue = {
  name: string;
  value: number;
  cStatus: number;
};

export type PerfmonCounterInfo = {
  objectName: string;
  multiInstance: boolean;
  counters: string[];
};

function buildCollectCounterDataEnvelope(perfmonHost: string, object: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonCollectCounterData>" +
    `<soap:Host>${escapeXml(perfmonHost)}</soap:Host>` +
    `<soap:Object>${escapeXml(object)}</soap:Object>` +
    "</soap:perfmonCollectCounterData>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function buildListCounterEnvelope(perfmonHost: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonListCounter>" +
    `<soap:Host>${escapeXml(perfmonHost)}</soap:Host>` +
    "</soap:perfmonListCounter>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function buildListInstanceEnvelope(perfmonHost: string, object: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonListInstance>" +
    `<soap:Host>${escapeXml(perfmonHost)}</soap:Host>` +
    `<soap:Object>${escapeXml(object)}</soap:Object>` +
    "</soap:perfmonListInstance>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

export async function perfmonCollectCounterData(
  hostOrUrl: string,
  perfmonHost: string,
  object: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<PerfmonCounterValue[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildCollectCounterDataEnvelope(perfmonHost, object);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonCollectCounterData",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.perfmonCollectCounterDataResponse as Record<string, unknown> | undefined;
  const aoci = resp?.ArrayOfCounterInfo as Record<string, unknown> | undefined;
  const items = toArray(aoci?.item ?? resp?.perfmonCollectCounterDataReturn) as Record<string, unknown>[];

  return items.map((item) => ({
    name: String(item.Name ?? ""),
    value: Number(item.Value ?? 0),
    cStatus: Number(item.CStatus ?? 0),
  }));
}

export async function perfmonListCounter(
  hostOrUrl: string,
  perfmonHost: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<PerfmonCounterInfo[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildListCounterEnvelope(perfmonHost);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonListCounter",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.perfmonListCounterResponse as Record<string, unknown> | undefined;
  const aooi = resp?.ArrayOfObjectInfo as Record<string, unknown> | undefined;
  const items = toArray(aooi?.item ?? resp?.perfmonListCounterReturn) as Record<string, unknown>[];

  return items.map((item) => {
    const countersRaw = toArray(
      (item.ArrayOfCounter as Record<string, unknown>)?.item ??
        (item.ArrayOfCounter as Record<string, unknown>)?.Counter,
    ) as Record<string, unknown>[];
    return {
      objectName: String(item.Name ?? ""),
      multiInstance: item.MultiInstance === true || item.MultiInstance === "true",
      counters: countersRaw.map((c) => String(c.Name ?? c)),
    };
  });
}

export async function perfmonListInstance(
  hostOrUrl: string,
  perfmonHost: string,
  object: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<string[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildListInstanceEnvelope(perfmonHost, object);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonListInstance",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.perfmonListInstanceResponse as Record<string, unknown> | undefined;
  const aoii = resp?.ArrayOfInstanceInfo as Record<string, unknown> | undefined;
  const items = toArray(aoii?.item ?? resp?.perfmonListInstanceReturn) as Record<string, unknown>[];

  return items.map((item) => String(item.Name ?? item));
}
