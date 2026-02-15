import { startJobCreatedConsumer } from "./job-created.consumer";

export async function startConsumers() {
  await startJobCreatedConsumer();
}
