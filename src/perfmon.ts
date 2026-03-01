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

/* ------------------------------------------------------------------ */
/*  PerfMon Session-based functions                                    */
/* ------------------------------------------------------------------ */

function buildOpenSessionEnvelope(): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonOpenSession/>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function buildAddCounterEnvelope(sessionHandle: string, counters: string[]): string {
  const counterItems = counters
    .map((c) => `<soap:Counter><soap:Name>${escapeXml(c)}</soap:Name></soap:Counter>`)
    .join("");
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonAddCounter>" +
    `<soap:SessionHandle>${escapeXml(sessionHandle)}</soap:SessionHandle>` +
    `<soap:ArrayOfCounter>${counterItems}</soap:ArrayOfCounter>` +
    "</soap:perfmonAddCounter>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function buildCollectSessionDataEnvelope(sessionHandle: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonCollectSessionData>" +
    `<soap:SessionHandle>${escapeXml(sessionHandle)}</soap:SessionHandle>` +
    "</soap:perfmonCollectSessionData>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function buildCloseSessionEnvelope(sessionHandle: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:perfmonCloseSession>" +
    `<soap:SessionHandle>${escapeXml(sessionHandle)}</soap:SessionHandle>` +
    "</soap:perfmonCloseSession>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

export async function perfmonOpenSession(
  hostOrUrl: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<string> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildOpenSessionEnvelope();

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonOpenSession",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.perfmonOpenSessionResponse as Record<string, unknown> | undefined;
  const handle = resp?.perfmonOpenSessionReturn ?? resp?.SessionHandle;
  if (!handle) throw new Error("perfmonOpenSession returned no session handle");
  return String(handle);
}

export async function perfmonAddCounter(
  hostOrUrl: string,
  sessionHandle: string,
  counters: string[],
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<void> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildAddCounterEnvelope(sessionHandle, counters);

  await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonAddCounter",
    envelope,
    timeoutMs ?? 30_000,
  );
}

export async function perfmonCollectSessionData(
  hostOrUrl: string,
  sessionHandle: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<PerfmonCounterValue[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildCollectSessionDataEnvelope(sessionHandle);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonCollectSessionData",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.perfmonCollectSessionDataResponse as Record<string, unknown> | undefined;
  const aoci = resp?.ArrayOfCounterInfo as Record<string, unknown> | undefined;
  const items = toArray(aoci?.item ?? resp?.perfmonCollectSessionDataReturn) as Record<string, unknown>[];

  return items.map((item) => ({
    name: String(item.Name ?? ""),
    value: Number(item.Value ?? 0),
    cStatus: Number(item.CStatus ?? 0),
  }));
}

export async function perfmonCloseSession(
  hostOrUrl: string,
  sessionHandle: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<void> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildCloseSessionEnvelope(sessionHandle);

  await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    PERFMON_PATH,
    "perfmonCloseSession",
    envelope,
    timeoutMs ?? 30_000,
  );
}
