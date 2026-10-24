import { ServerAPI } from "./server-api.ts";

export async function buildApp() {
  return new ServerAPI().build();
}
