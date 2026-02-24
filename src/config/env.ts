// Environment Configuration

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000"),
  logLevel: process.env.LOG_LEVEL || "info",

  workerRegistrationToken: process.env.WORKER_REGISTRATION_TOKEN || "",

  rabbitmq: {
    url: process.env.RABBITMQ_URL || Bun.env.RABBITMQ_URL || "",
    vhost: process.env.RABBITMQ_VHOST || "/",
    managementUrl: process.env.RABBITMQ_MGMT_URL || "",
    managementUsername: process.env.RABBITMQ_MGMT_USERNAME || "",
    managementPassword: process.env.RABBITMQ_MGMT_PASSWORD || "",
  },
};
