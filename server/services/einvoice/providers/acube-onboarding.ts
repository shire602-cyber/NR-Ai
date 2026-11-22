import { randomUUID } from "node:crypto";
import type { Company, EInvoiceLegalEntity } from "../../../../shared/schema";
import { db } from "../../../db";
import { DomainError } from "../../../errors";
import {
  getLegalEntity,
  lockOnboardingCompany,
  matchesOnboardingCompany,
  newOnboardingEntity,
  patchFromAcube,
  requireCompanyTin,
  updateLegalEntityRowIfCurrent,
  upsertLegalEntity,
} from "../legal-entities";
import { ACUBE_PROVIDER_NAME, acubeEnvironment, AcubeEInvoiceProvider } from "./acube";
import { providerObject } from "./response";

// A request can include two logins and two bounded API attempts after a 401.
const RESERVATION_LEASE_MS = 5 * 60_000;

function reservationDetails(entity: EInvoiceLegalEntity | undefined) {
  return providerObject(entity?.providerDetails) ?? {};
}

/** A manual refresh follows the same local identity and revision fence as signed events. */
export async function syncAcubeCompany(company: Company, provider: AcubeEInvoiceProvider) {
  const name = ACUBE_PROVIDER_NAME;
  const env = provider.environment;
  const entity = await getLegalEntity(company.id, name, env);
  if (!entity?.legalEntityId) {
    throw new DomainError(
      "EINVOICE_LEGAL_ENTITY_NOT_RESERVED",
      409,
      undefined,
      "Reserve the TIN first."
    );
  }
  const tin = requireCompanyTin(company);
  if (entity.tin !== tin) throw new DomainError("EINVOICE_SUPPLIER_ENDPOINT_MISMATCH", 422);
  const remote = await provider.getLegalEntity(entity.legalEntityId, tin);
  const patch = patchFromAcube({ ...remote, action: "SYNC" });
  if (patch.status === "active" && entity.status !== "active") patch.activatedAt = new Date();
  return db.transaction(async (tx) => {
    const latest = await lockOnboardingCompany(company.id, tx);
    if (acubeEnvironment() !== env || !matchesOnboardingCompany(latest, name, tin)) {
      throw new DomainError("EINVOICE_PROVIDER_NOT_CONFIGURED", 409);
    }
    if (!(await updateLegalEntityRowIfCurrent(entity, { ...patch, lastError: null }, tx))) {
      throw new DomainError("EINVOICE_LEGAL_ENTITY_NOT_RESERVED", 409);
    }
    return getLegalEntity(company.id, name, env, tx);
  });
}

export async function reserveAcubeCompany(args: {
  company: Company;
  provider: AcubeEInvoiceProvider;
  approver: "me" | "someone_else";
  approverEmail?: string | null;
}) {
  const { company, provider } = args;
  const name = ACUBE_PROVIDER_NAME;
  const env = provider.environment;
  const tin = requireCompanyTin(company);
  const operationId = randomUUID();
  const assertScope = (current: Company | undefined) => {
    if (acubeEnvironment() !== env || current?.einvoicePartner !== name) {
      throw new DomainError("EINVOICE_PROVIDER_NOT_CONFIGURED", 409);
    }
    if (!matchesOnboardingCompany(current, name, tin)) {
      throw new DomainError("EINVOICE_SUPPLIER_ENDPOINT_MISMATCH", 422);
    }
  };
  const intent = await db.transaction(async (tx) => {
    assertScope(await lockOnboardingCompany(company.id, tx));
    const saved = await getLegalEntity(company.id, name, env, tx, "update");
    const prior = saved?.tin === tin ? saved : undefined;
    const details = reservationDetails(prior);
    if (prior?.status === "active" && prior.legalEntityId)
      return { row: prior, send: false, pending: false };
    if (
      prior &&
      typeof details.acubeReservationLeaseUntil === "number" &&
      details.acubeReservationLeaseUntil > Date.now()
    ) {
      return { row: prior, send: false, pending: true };
    }
    const row = await upsertLegalEntity(
      company.id,
      name,
      env,
      tin,
      {
        ...(prior ? {} : newOnboardingEntity),
        approver: args.approver,
        approverEmail: args.approver === "someone_else" ? (args.approverEmail ?? null) : null,
        lastAction: "RESERVE",
        lastError: null,
        providerDetails: {
          ...details,
          acubeReservationOperation: operationId,
          acubeReservationLeaseUntil: Date.now() + RESERVATION_LEASE_MS,
        },
      },
      tx
    );
    return { row, send: true, pending: false };
  });
  if (!intent.send) return { row: intent.row, pending: intent.pending };

  // A lost response is safe to retry: A-Cube reserves by account and TIN and refreshes it on repeat.
  try {
    const reserved = await provider.reserveLegalEntity(tin);
    return await db.transaction(async (tx) => {
      assertScope(await lockOnboardingCompany(company.id, tx));
      const row = await getLegalEntity(company.id, name, env, tx, "update");
      const details = reservationDetails(row);
      if (!row || row.tin !== tin || details.acubeReservationOperation !== operationId) {
        throw new DomainError("EINVOICE_LEGAL_ENTITY_NOT_RESERVED", 409);
      }
      if (row.legalEntityId && row.legalEntityId !== reserved.legalEntityId) {
        throw new DomainError("EINVOICE_PROVIDER_TIN_MISMATCH", 502);
      }
      // A newer authenticated callback for the already-known ID beats this reservation response.
      const patch =
        !row.legalEntityId || row.updatedAt.getTime() === intent.row.updatedAt.getTime()
          ? patchFromAcube(reserved)
          : {};
      if (patch.status === "active" && row.status !== "active") patch.activatedAt = new Date();
      const updated = await upsertLegalEntity(
        company.id,
        name,
        env,
        tin,
        {
          ...patch,
          providerDetails: {
            ...details,
            acubeReservationOperation: null,
            acubeReservationLeaseUntil: null,
          },
        },
        tx
      );
      return { row: updated, pending: false };
    });
  } catch (error) {
    await db.transaction(async (tx) => {
      await lockOnboardingCompany(company.id, tx);
      const row = await getLegalEntity(company.id, name, env, tx, "update");
      const details = reservationDetails(row);
      if (row?.tin !== tin || details.acubeReservationOperation !== operationId) return;
      await upsertLegalEntity(
        company.id,
        name,
        env,
        tin,
        {
          providerDetails: {
            ...details,
            acubeReservationOperation: null,
            acubeReservationLeaseUntil: null,
          },
        },
        tx
      );
    });
    throw error;
  }
}
