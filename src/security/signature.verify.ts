import crypto from "node:crypto";
import { prisma } from "@/config/db";
import { getLogger, instrumentedQuery } from "@computebay/observability";

const logger = getLogger();

function buildVerifiablePayload(payload: Record<string, unknown>): string {
  const { signature: _sig, ...rest } = payload;
  return JSON.stringify(rest);
}

function verifySignature(
  payloadString: string,
  publicKey: string,
  signatureBase64: string,
): boolean {
  try {
    let keyObject: crypto.KeyObject;
    if (publicKey.includes("-----BEGIN")) {
      keyObject = crypto.createPublicKey(publicKey);
    } else {
      const raw = Buffer.from(publicKey, "base64");
      if (raw.length !== 32) return false;
      const spki = Buffer.concat([
        Buffer.from([
          0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ]),
        raw,
      ]);
      keyObject = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    }
    return crypto.verify(
      null,
      Buffer.from(payloadString, "utf8"),
      keyObject,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export async function verifyWorkerMessage(
  nodeId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const signature = payload.signature as string | undefined;
  if (!nodeId || !signature) {
    logger.warn({ nodeId }, "Message missing nodeId or signature – rejecting");
    return false;
  }

  const node = await instrumentedQuery("SELECT", "nodes", "scheduler-service", () =>
    prisma.node.findUnique({
      where: { id: nodeId },
      select: { publicKey: true },
    }),
  );

  if (!node?.publicKey) {
    logger.warn({ nodeId }, "Node not found or missing publicKey – rejecting");
    return false;
  }

  const payloadString = buildVerifiablePayload(payload);
  if (!verifySignature(payloadString, node.publicKey, signature)) {
    logger.warn({ nodeId }, "Signature verification failed – rejecting");
    return false;
  }

  return true;
}

export async function verifyWorkerMessageWithProvidedKey(
  nodeId: string,
  payload: Record<string, unknown>,
  publicKey: string,
): Promise<boolean> {
  const signature = payload.signature as string | undefined;
  if (!nodeId || !publicKey || !signature) {
    logger.warn({ nodeId }, "Registration message missing nodeId, publicKey, or signature – rejecting");
    return false;
  }

  const payloadString = buildVerifiablePayload(payload);
  if (!verifySignature(payloadString, publicKey, signature)) {
    logger.warn({ nodeId }, "Registration signature verification failed – rejecting");
    return false;
  }

  return true;
}
