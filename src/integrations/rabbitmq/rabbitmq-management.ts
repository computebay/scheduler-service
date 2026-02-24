import { env } from "@/config/env";

type RabbitMqUserDefinition = {
  password: string;
  tags?: string;
};

type RabbitMqPermissionsDefinition = {
  configure: string;
  write: string;
  read: string;
};

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

function requireMgmtConfig() {
  const { managementUrl, managementUsername, managementPassword } = env.rabbitmq;
  if (!managementUrl || !managementUsername || !managementPassword) {
    throw new Error(
      "RabbitMQ management API config missing (RABBITMQ_MGMT_URL/_USERNAME/_PASSWORD)",
    );
  }
  return { managementUrl, managementUsername, managementPassword };
}

async function mgmtFetch(path: string, init: RequestInit): Promise<Response> {
  const { managementUrl, managementUsername, managementPassword } = requireMgmtConfig();
  const url = new URL(path, managementUrl).toString();
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: basicAuthHeader(managementUsername, managementPassword),
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

async function requireOk(res: Response, context: string) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${context} failed: ${res.status} ${res.statusText} ${body}`);
}

export async function upsertRabbitMqUser(username: string, password: string) {
  const body: RabbitMqUserDefinition = { password, tags: "" };
  const res = await mgmtFetch(`/api/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  await requireOk(res, "RabbitMQ create/update user");
}

export async function setRabbitMqPermissions(
  username: string,
  vhost: string,
  perms: RabbitMqPermissionsDefinition,
) {
  const vhostEncoded = encodeURIComponent(vhost);
  const res = await mgmtFetch(
    `/api/permissions/${vhostEncoded}/${encodeURIComponent(username)}`,
    {
      method: "PUT",
      body: JSON.stringify(perms),
    },
  );
  await requireOk(res, "RabbitMQ set permissions");
}

